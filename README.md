# pool-pulse

[![ci](https://github.com/donbagger/pool-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/donbagger/pool-pulse/actions/workflows/ci.yml)
[![Powered by DexPaprika](https://dexpaprika.com/badges/powered-by-dexpaprika.svg?t=bwt_GfIi3FJPpNFksm5y)](https://dexpaprika.com)

The most traded DEX pools on any chain, in your terminal. Node 20 or newer, no
dependencies, and no API key needed to start.

```
$ pool-pulse solana
Top pools on solana by 24h volume

#  Pair       DEX           Volume 24h  Liquidity  Change 24h  Txns 24h
1  SOL/USDC   Orca             $83.74M    $24.25M      -3.12%    81,424
2  USDC/USDT  Jup Lend Amm     $21.38M     $3.00M       0.00%    64,480
3  SOL/USDC   Raydium CLMM     $17.86M     $6.60M      -3.04%    49,771
4  SOL/XTEN   PumpSwap         $17.15M    $143.5K     +58.27%    33,059
5  SOL/USDC   Meteora          $15.98M     $3.87M      -3.01%    13,675

No key set. A free one from https://console.dexpaprika.com raises the rate limit.
```

(That last line goes to stderr, so piping the table elsewhere leaves it out.)

The data comes from the [DexPaprika API](https://docs.dexpaprika.com), which covers
pools on 35 chains.

## Run it

```bash
git clone https://github.com/donbagger/pool-pulse
cd pool-pulse
node bin/pool-pulse.mjs                 # Solana, top 5
node bin/pool-pulse.mjs base -n 10      # Base, top 10
node bin/pool-pulse.mjs --networks      # every network id you can pass
```

`npm link` puts `pool-pulse` on your PATH. There is nothing to `npm install`.

| Option | Default | |
|---|---|---|
| `[network]` | `solana` | a network id from `--networks` |
| `-n, --limit` | `5` | 1 to 10 pools |
| `-m, --min-liquidity` | `10000` | skip pools with less USD liquidity; `0` turns it off |
| `--timeout` | `15000` | milliseconds per request |
| `--json` | off | JSON on stdout, and errors as JSON on stderr |
| `--networks` | | list the network ids and exit |
| `-h, --help` / `-v, --version` | | |

## API key

You don't need one. Without a key, DexPaprika limits requests per IP, and each run of
pool-pulse makes `limit + 1` requests. A free key from
[console.dexpaprika.com](https://console.dexpaprika.com) raises that limit. Current
limits for every plan are on the [pricing page](https://dexpaprika.com/api/pricing).

```bash
export DEXPAPRIKA_API_KEY=your-key
# or: cp .env.example .env, fill it in, then
node --env-file=.env bin/pool-pulse.mjs
```

The key goes in the `Authorization` header on its own, with nothing in front of it. On a
paid plan, also set `DEXPAPRIKA_BASE_URL=https://api-pro.dexpaprika.com`. pool-pulse
refuses any other base URL and does not follow redirects, so the key only ever goes to
DexPaprika.

## For scripts and agents

`--json` prints one object:

```json
{
  "network": "solana",
  "min_liquidity_usd": 10000,
  "pools": [
    {
      "rank": 1,
      "id": "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
      "pair": "SOL/USDC",
      "dex": "Orca",
      "volume_usd_24h": 83737011.62491943,
      "liquidity_usd": 24253894.09136931,
      "price_change_24h_pct": -3.1158356084602197,
      "transactions_24h": 81424,
      "url": "https://dexpaprika.com/solana/pool/Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
    }
  ],
  "docs_url": "https://docs.dexpaprika.com",
  "console_url": "https://console.dexpaprika.com",
  "pricing_url": "https://dexpaprika.com/api/pricing"
}
```

Errors go to stderr. With `--json` they are JSON too, with the API's own error code:

```
$ pool-pulse nochain --json
{"error":"unsupported_network","message":"unsupported network","status":404,"retry_after":null,"hint":"Run `pool-pulse --networks` for the network ids DexPaprika supports.","tier":null,"required_tier":null,"param":"network","docs_url":"https://docs.dexpaprika.com","console_url":"https://console.dexpaprika.com","pricing_url":"https://dexpaprika.com/api/pricing"}
$ echo $?
1
```

`tier`, `required_tier` and `param` are copied from the API's error body when it has
them: on a `plan_required` refusal, `required_tier` is the lowest plan that allows the
request.

| Exit code | Meaning |
|---|---|
| `0` | success |
| `1` | the API or the network failed; `error` says which (`rate_limited`, `payment_required`, `unsupported_network`, `timeout`, ...) |
| `2` | bad arguments or a bad `DEXPAPRIKA_BASE_URL`; nothing was sent |

From JavaScript:

```js
import { createClient, topPools } from './src/index.mjs'

const pools = await topPools(createClient({ apiKey: process.env.DEXPAPRIKA_API_KEY }), { network: 'base', limit: 3 })
```

Coding agents working on this repo should read [AGENTS.md](AGENTS.md) first.

## How it works

1. `GET /networks/{network}/pools/search?order_by=volume_usd_24h&sort=desc&limit={n}&liquidity_usd_min={floor}`
2. `GET /networks/{network}/pools/{address}` for each pool, because search results carry
   token addresses but not symbols.

The liquidity floor is there because volume on its own can mislead. On 9 Nov 2026, without
it, places 2 and 3 on Solana were pools holding less than a cent of liquidity and
reporting over $27M of 24h volume each.

A 429 with a short `Retry-After` is retried once. A longer one is reported, with the
number of seconds, instead of leaving your terminal hanging.

## Tests

```bash
npm test         # offline, against responses recorded from the live API
npm run smoke    # live, 5 requests
```

CI runs both, the live one daily, so a green badge means it worked against the API today.

## Links

- [DexPaprika docs](https://docs.dexpaprika.com) and the
  [pool filtering reference](https://docs.dexpaprika.com/api-reference/pools/advanced-pool-filtering-on-a-specific-network)
- [Free API key](https://console.dexpaprika.com)
- [Plans and limits](https://dexpaprika.com/api/pricing)
- [pool-depth](https://github.com/donbagger/pool-depth): is a pool deep enough for your trade
- [dexpaprika-agent-kit](https://github.com/donbagger/dexpaprika-agent-kit): small Python agents on the same data

MIT licensed. Not financial advice.
