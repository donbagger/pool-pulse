import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXIT, main } from '../src/cli.mjs'
import { topPools } from '../src/pulse.mjs'
import { createClient } from '../src/client.mjs'
import { clean, pct } from '../src/format.mjs'
import { capture, fakeApi, fixture, json, noSleep } from './helpers.mjs'

const run = (argv, api = fakeApi(), env = {}) => {
  const io = capture()
  return main(argv, { env, fetch: api.fetch, sleep: noSleep, ...io }).then((code) => ({ code, ...io.out, api }))
}

test('prints a table of the top pools with symbols from pool details', async () => {
  const { code, stdout, stderr } = await run(['solana', '-n', '3'])
  assert.equal(code, EXIT.OK)
  assert.match(stdout, /Top pools on solana by 24h volume/)
  assert.match(stdout, /1\s+SOL\/USDC\s+Orca/)
  assert.match(stdout, /USDC\/USDT\s+Jup Lend Amm/)
  assert.match(stderr, /No key set/)
})

test('--json prints one parseable object with links as fields', async () => {
  const { code, stdout } = await run(['--json', '-n', '3'])
  assert.equal(code, EXIT.OK)
  const out = JSON.parse(stdout)
  assert.equal(out.network, 'solana')
  assert.equal(out.pools.length, 3)
  assert.deepEqual(Object.keys(out.pools[0]), [
    'rank', 'id', 'pair', 'dex', 'volume_usd_24h', 'liquidity_usd', 'price_change_24h_pct', 'transactions_24h', 'url',
  ])
  assert.equal(out.pools[0].pair, 'SOL/USDC')
  assert.equal(out.pools[0].url, 'https://dexpaprika.com/solana/pool/Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE')
  assert.equal(out.console_url, 'https://console.dexpaprika.com')
})

test('asks the API for volume order, the limit and a liquidity floor', async () => {
  const { api } = await run(['base', '-n', '2', '-m', '5000'])
  const q = api.calls[0].url
  assert.equal(q.pathname, '/networks/base/pools/search')
  assert.equal(q.searchParams.get('order_by'), 'volume_usd_24h')
  assert.equal(q.searchParams.get('sort'), 'desc')
  assert.equal(q.searchParams.get('limit'), '2')
  assert.equal(q.searchParams.get('liquidity_usd_min'), '5000')
})

test('--min-liquidity 0 drops the floor from the request', async () => {
  const { api } = await run(['-m', '0'])
  assert.equal(api.calls[0].url.searchParams.has('liquidity_usd_min'), false)
})

test('one details request per pool, so limit 3 costs 4 requests', async () => {
  const { api } = await run(['-n', '3'])
  assert.equal(api.calls.length, 4)
})

test('bad arguments exit 2 before any request', async () => {
  for (const argv of [['-n', '0'], ['-n', '11'], ['-n', 'abc'], ['-n', '1e1'], ['-n', '2.0'], ['--nope'], ['a', 'b'], ['../etc'], ['so lana'], ['--timeout', '5']]) {
    const { code, api } = await run(argv)
    assert.equal(code, EXIT.USAGE, argv.join(' '))
    assert.equal(api.calls.length, 0, argv.join(' '))
  }
})

test('a typo in a flag names the flag', async () => {
  const { code, stderr } = await run(['--limitx', '3'])
  assert.equal(code, EXIT.USAGE)
  assert.equal(stderr, 'pool-pulse: Unknown option --limitx.\nRun pool-pulse --help.\n')
})

test('a bad DEXPAPRIKA_BASE_URL exits 2 and sends nothing', async () => {
  const { code, stderr, api } = await run([], fakeApi(), { DEXPAPRIKA_BASE_URL: 'https://evil.test', DEXPAPRIKA_API_KEY: 'k' })
  assert.equal(code, EXIT.USAGE)
  assert.match(stderr, /DEXPAPRIKA_BASE_URL must be/)
  assert.equal(api.calls.length, 0)
})

test('an API error exits 1; with --json the error is JSON on stderr (recorded 404)', async () => {
  const api = fakeApi({ '/pools/search': () => json(fixture('error-unsupported-network.json'), 404) })
  const { code, stdout, stderr } = await run(['nochain', '--json'], api)
  assert.equal(code, EXIT.API_ERROR)
  assert.equal(stdout, '')
  const err = JSON.parse(stderr)
  assert.equal(err.error, 'unsupported_network')
  assert.equal(err.status, 404)
  assert.match(err.hint, /--networks/)
  assert.equal(err.pricing_url, 'https://dexpaprika.com/api/pricing')
})

test('a pool that disappears between calls still gets a row', async () => {
  const api = fakeApi({ '/pools/Czfq': () => json({ error: 'not_found', message: 'pool not found' }, 404) })
  const pools = await topPools(createClient({ fetch: api.fetch }), { limit: 3 })
  assert.equal(pools.length, 3)
  assert.equal(pools[0].pair, 'So11..1112/EPjF..Dt1v')
})

test('hostile token symbols cannot write escape codes to the terminal', async () => {
  const evil = fixture('pool-Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE.json')
  evil.tokens[0].symbol = 'SOL\u001b]0;pwned\u0007\u001b[2J\u009b31m\u202eX'
  const api = fakeApi({ '/pools/Czfq': () => json(evil) })
  const { stdout } = await run(['-n', '1'], api)
  assert.doesNotMatch(stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e]/)
  assert.match(stdout, /SOL\]0;pwned\[2J31mX\/USDC/)
})

test('formatting helpers', () => {
  assert.equal(pct(-0.0001), '0.00%')
  assert.equal(pct(2.5), '+2.50%')
  assert.equal(pct(-2.5), '-2.50%')
  assert.equal(clean('a\u001bb\u202ec'), 'abc')
})

test('--networks lists ids, --help and --version need no network', async () => {
  const api = fakeApi({ '/networks': () => json([{ id: 'solana', display_name: 'Solana' }]) })
  assert.match((await run(['--networks'], api)).stdout, /solana\s+Solana/)
  const help = await run(['--help'])
  assert.equal(help.code, EXIT.OK)
  assert.match(help.stdout, /Exit codes/)
  assert.equal(help.api.calls.length, 0)
  assert.match((await run(['-v'])).stdout, /^\d+\.\d+\.\d+\n$/)
})
