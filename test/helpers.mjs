// A fake DexPaprika API built from responses recorded live on 9 Nov 2026 (test/fixtures).
// Tests never touch the network; `npm run smoke` is the live check.

import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('./fixtures/', import.meta.url)
export const fixture = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'))

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** A fetch that answers search and pool details from fixtures and records every call. */
export function fakeApi(overrides = {}) {
  const pools = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.startsWith('pool-'))
      .map((f) => [f.slice(5, -5), fixture(f)]),
  )
  const calls = []
  const fetch = async (url, init) => {
    const u = new URL(url)
    calls.push({ url: u, headers: init.headers })
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (u.pathname.includes(pattern)) return handler(u, calls.length)
    }
    if (u.pathname.endsWith('/pools/search')) return json(fixture('search-solana.json'))
    const m = u.pathname.match(/\/pools\/([^/]+)$/)
    if (m && pools[m[1]]) return json(pools[m[1]])
    return json({ error: 'not_found', message: 'pool not found', resource: 'pool' }, 404)
  }
  return { fetch, calls }
}

export function capture() {
  const out = { stdout: '', stderr: '' }
  return {
    out,
    stdout: { write: (s) => (out.stdout += s) },
    stderr: { write: (s) => (out.stderr += s) },
  }
}

export const noSleep = async () => {}
