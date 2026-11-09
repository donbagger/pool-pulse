// The data side of pool-pulse: which pools, in what order, with which numbers.

import { DexPaprikaError } from './client.mjs'
import { clean } from './format.mjs'

export const NETWORK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_LIMIT = 10

/**
 * The most traded pools on one network over the last 24 hours.
 *
 * One search request, then one details request per pool for the token symbols, which the
 * search response does not carry. So `limit` 5 costs 6 requests.
 *
 * @param {{ get: (path: string, params?: object) => Promise<any> }} client
 * @param {{ network?: string, limit?: number, minLiquidity?: number }} [opts]
 */
export async function topPools(client, { network = 'solana', limit = 5, minLiquidity = 10_000 } = {}) {
  if (!NETWORK_ID.test(network)) {
    throw new DexPaprikaError({ code: 'invalid_param', message: `Not a network id: ${JSON.stringify(network)}` })
  }
  const search = await client.get(`/networks/${network}/pools/search`, {
    order_by: 'volume_usd_24h',
    sort: 'desc',
    limit,
    // Sorted by volume alone, the top of the list on busy chains is often pools with a few
    // cents of liquidity. A floor keeps the list to pools someone could actually trade in.
    liquidity_usd_min: minLiquidity > 0 ? minLiquidity : undefined,
  })

  const pools = []
  for (const [i, row] of (search.results ?? []).entries()) {
    pools.push(toPool(i + 1, network, row, await details(client, network, row.id)))
  }
  return pools
}

async function details(client, network, id) {
  try {
    return await client.get(`/networks/${network}/pools/${encodeURIComponent(id)}`)
  } catch (err) {
    // A pool that vanished between the two calls still gets a row, with short ids for a name.
    if (err instanceof DexPaprikaError && err.status === 404) return null
    throw err
  }
}

function toPool(rank, network, row, detail) {
  const symbols = detail?.tokens?.map((t) => t.symbol || shortId(t.id))
  return {
    rank,
    id: clean(row.id),
    // Symbols and names are set by whoever deployed the token, so they are cleaned here once
    // and are safe to print from the JSON as well as the table.
    pair: clean((symbols ?? row.tokens?.map((t) => shortId(t.id)) ?? []).join('/')),
    dex: clean(row.dex_name ?? row.dex_id ?? ''),
    volume_usd_24h: num(row.volume_usd_24h),
    liquidity_usd: num(row.liquidity_usd),
    price_change_24h_pct: num(row.price_change_percentage_24h),
    transactions_24h: num(row.transactions_24h),
    url: `https://dexpaprika.com/${network}/pool/${encodeURIComponent(row.id)}`,
  }
}

const shortId = (id) => (typeof id === 'string' && id.length > 10 ? `${id.slice(0, 4)}..${id.slice(-4)}` : String(id ?? '?'))
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Network ids and names, for `--networks`. One request. */
export async function networks(client) {
  const list = await client.get('/networks')
  return list.map((n) => ({ id: clean(n.id), name: clean(n.display_name) }))
}
