// Use pool-pulse from your own code or an agent tool:
//
//   import { createClient, topPools } from './src/index.mjs'   // from a clone of this repo
//   const pools = await topPools(createClient(), { network: 'base', limit: 3 })

export { createClient, DexPaprikaError, FREE_HOST, PAID_HOST, LINKS } from './client.mjs'
export { topPools, networks, MAX_LIMIT } from './pulse.mjs'
export { main, EXIT, VERSION } from './cli.mjs'
