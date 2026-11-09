// Argument parsing and output. main() returns an exit code instead of exiting, so the tests
// can run it in-process with a fake API.

import { parseArgs } from 'node:util'
import { createClient, DexPaprikaError, LINKS } from './client.mjs'
import { MAX_LIMIT, NETWORK_ID, networks, topPools } from './pulse.mjs'
import { table } from './format.mjs'

export const VERSION = '1.0.0'

export const EXIT = Object.freeze({ OK: 0, API_ERROR: 1, USAGE: 2 })

const HELP = `pool-pulse ${VERSION}: the most traded DEX pools on a network, from DexPaprika.

Usage
  pool-pulse [network] [options]

Arguments
  network                 network id, default solana (see --networks)

Options
  -n, --limit <1-${MAX_LIMIT}>      how many pools, default 5
  -m, --min-liquidity <usd>
                          skip pools with less liquidity than this, default 10000; 0 turns it off
      --timeout <ms>      per request, default 15000
      --json              print JSON instead of a table, errors included
      --networks          list network ids and exit
  -h, --help              show this help
  -v, --version           print the version

Environment
  DEXPAPRIKA_API_KEY      optional; sent as the Authorization header, the key on its own
  DEXPAPRIKA_BASE_URL     optional; https://api-pro.dexpaprika.com for paid plans

Exit codes
  0  success   1  the API or the network failed
  2  bad arguments or DEXPAPRIKA_BASE_URL; nothing was sent

Docs ${LINKS.docs_url}   Free key ${LINKS.console_url}   Plans ${LINKS.pricing_url}
`

export function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      limit: { type: 'string', short: 'n', default: '5' },
      'min-liquidity': { type: 'string', short: 'm', default: '10000' },
      timeout: { type: 'string', default: '15000' },
      json: { type: 'boolean', default: false },
      networks: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })
  if (positionals.length > 1) throw usage(`Expected one network, got ${positionals.length}: ${positionals.join(' ')}`)
  const network = (positionals[0] ?? 'solana').toLowerCase()
  if (!NETWORK_ID.test(network)) throw usage(`Not a network id: ${JSON.stringify(network)}. Run pool-pulse --networks.`)
  return {
    network,
    limit: int(values.limit, 'limit', 1, MAX_LIMIT),
    minLiquidity: int(values['min-liquidity'], 'min-liquidity', 0, 1e12),
    timeoutMs: int(values.timeout, 'timeout', 1000, 120_000),
    json: values.json,
    networks: values.networks,
    help: values.help,
    version: values.version,
  }
}

function int(raw, name, min, max) {
  const n = /^\d+$/.test(String(raw).trim()) ? Number(raw) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw usage(`--${name} must be a whole number from ${min} to ${max}, got ${JSON.stringify(raw)}`)
  return n
}

function usage(message) {
  return new DexPaprikaError({ code: 'usage', message, hint: 'Run pool-pulse --help.' })
}

/**
 * @param {string[]} argv
 * @param {{ env?: object, stdout?: { write(s: string): void }, stderr?: { write(s: string): void }, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [io]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, fetch, sleep } = {}) {
  const wantsJson = argv.includes('--json')
  try {
    const args = parse(argv)
    if (args.help) return stdout.write(HELP), EXIT.OK
    if (args.version) return stdout.write(`${VERSION}\n`), EXIT.OK

    const client = createClient({
      apiKey: env.DEXPAPRIKA_API_KEY ?? '',
      baseUrl: env.DEXPAPRIKA_BASE_URL,
      timeoutMs: args.timeoutMs,
      userAgent: `pool-pulse/${VERSION}`,
      ...(fetch && { fetch }),
      ...(sleep && { sleep }),
    })

    if (args.networks) {
      const list = await networks(client)
      stdout.write(args.json ? JSON.stringify(list, null, 2) + '\n' : list.map((n) => `${n.id.padEnd(18)} ${n.name}`).join('\n') + '\n')
      return EXIT.OK
    }

    const pools = await topPools(client, args)
    if (args.json) {
      stdout.write(JSON.stringify({ network: args.network, min_liquidity_usd: args.minLiquidity, pools, ...LINKS }, null, 2) + '\n')
    } else {
      stdout.write(`Top pools on ${args.network} by 24h volume\n\n${table(pools, args.network)}\n`)
      if (!client.hasKey) stderr.write(`\nNo key set. A free one from ${LINKS.console_url} raises the rate limit.\n`)
    }
    return EXIT.OK
  } catch (err) {
    const e = err instanceof DexPaprikaError ? err : fromUnknown(err)
    if (wantsJson) stderr.write(JSON.stringify(e) + '\n')
    else stderr.write(`pool-pulse: ${e.message}${e.hint ? `\n${e.hint}` : ''}\n`)
    return e.code === 'usage' || e.code === 'invalid_base_url' ? EXIT.USAGE : EXIT.API_ERROR
  }
}

function fromUnknown(err) {
  // parseArgs throws plain errors with ERR_PARSE_ARGS_* codes for unknown or malformed flags.
  if (err?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const flag = /'(-[^']*)'/.exec(err.message)?.[1] ?? 'that option'
    return usage(`Unknown option ${flag}.`)
  }
  if (typeof err?.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS')) return usage(err.message)
  return new DexPaprikaError({ code: 'internal', message: String(err?.message ?? err) })
}
