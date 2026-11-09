# AGENTS.md

Notes for coding agents (Claude Code, Codex, Cursor and the like) working in this repo, and
for agents that call pool-pulse as a tool.

## Calling pool-pulse as a tool

- Run `node bin/pool-pulse.mjs <network> --limit <1-10> --json`. Read stdout as JSON.
- On a non-zero exit, read stderr as JSON: `error` is the API's own code (`rate_limited`,
  `unsupported_network`, `plan_required`, `timeout`, ...), `hint` says what to do next,
  `retry_after` is seconds when the API gave one.
- Exit `2` means your arguments were wrong and nothing was sent. Do not retry it unchanged.
- `required_tier` in the error JSON names the plan that would allow a `plan_required`
  request; `tier` is the plan the request was judged against.
- Time budget: a run makes `limit + 1` requests one after another. Each has a `--timeout`
  (default 15000 ms), and each can wait out one 429 with a short `Retry-After` (at most
  20 s) and try again, so the worst case is about `(limit + 1) * (2 * timeout + 20 s)`.
  Nothing else is retried. Give your loop its own deadline.
- Unsure of a network id? `node bin/pool-pulse.mjs --networks --json`.
- Each run costs `limit + 1` requests. Without a key the API limits requests per IP, so
  keep `--limit` small in loops. A free key from https://console.dexpaprika.com raises the
  limit; plans are on https://dexpaprika.com/api/pricing.
- In code: `import { createClient, topPools } from './src/index.mjs'`.

## Working on the code

```bash
npm test          # offline, about 0.1 s, run it after every change
npm run smoke     # live API, 5 requests, run it before you push
```

- `src/client.mjs`: HTTP, timeout, 429 retry, errors. `src/pulse.mjs`: which requests and
  the shape of a pool row. `src/format.mjs`: terminal output. `src/cli.mjs`: flags, exit codes.
- No runtime dependencies. Node's own `fetch`, `node:test` and `node:util.parseArgs` cover
  everything. Ask before adding a package.
- `main()` returns the exit code and takes `fetch`, `sleep`, `stdout`, `stderr` and `env`
  as arguments, so tests run in-process. Keep it that way; never call `process.exit`.
- Tests use responses recorded from the live API in `test/fixtures/`. To re-record, fetch
  the same URLs with curl (see the file names) and keep the bodies unedited. Do not invent
  field names: read them off a live response.

## Rules that keep it safe

- The API key goes in the `Authorization` header with nothing in front of it. Never log
  it, print it, put it in a URL or write it to a file.
- `resolveBaseUrl` accepts exactly two hosts and requests use `redirect: 'error'`. These
  are what stop a key reaching anyone else; do not loosen them.
- Every string from the API passes through `clean()` before it is printed. Token symbols
  are set by whoever created the token and can contain terminal escape codes.
- Errors keep the API's `error` code. Agents branch on it, so do not rename codes.
- Do not hard-code rate limits or quotas in code or docs. They change; link the pricing page.
