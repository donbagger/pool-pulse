// Live check against the real API, run daily in CI. Five requests, so it fits the keyless limit.
// Exits non-zero, naming what broke, if the API stops answering the way this tool expects.

import { main, EXIT } from '../src/cli.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!ok) failures.push(what)
}

async function run(argv) {
  let stdout = ''
  let stderr = ''
  const code = await main(argv, { stdout: { write: (s) => (stdout += s) }, stderr: { write: (s) => (stderr += s) } })
  return { code, stdout, stderr }
}

const top = await run(['solana', '--limit', '3', '--json'])
check(top.code === EXIT.OK, `top pools exit ${top.code} ${top.stderr.trim()}`)
if (top.code === EXIT.OK) {
  const { pools } = JSON.parse(top.stdout)
  check(pools.length === 3, `3 pools returned (${pools.length})`)
  check(pools.every((p) => /\S\/\S/.test(p.pair)), `every pool has a pair name: ${pools.map((p) => p.pair).join(', ')}`)
  check(pools.every((p) => p.volume_usd_24h > 0 && p.liquidity_usd >= 10_000), 'volume is positive and liquidity is over the floor')
  check(pools.every((p, i) => i === 0 || pools[i - 1].volume_usd_24h >= p.volume_usd_24h), 'sorted by 24h volume')
}

const bad = await run(['not-a-chain', '--json'])
check(bad.code === EXIT.API_ERROR && JSON.parse(bad.stderr).error === 'unsupported_network', `unknown network is reported as unsupported_network (exit ${bad.code})`)

process.exitCode = failures.length ? 1 : 0
