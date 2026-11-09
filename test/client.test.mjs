import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, DexPaprikaError, FREE_HOST, PAID_HOST } from '../src/client.mjs'
import { fakeApi, fixture, json, noSleep } from './helpers.mjs'

test('sends the key as the whole Authorization value', async () => {
  const api = fakeApi()
  await createClient({ apiKey: '  abc123  ', fetch: api.fetch }).get('/networks/solana/pools/search')
  assert.equal(api.calls[0].headers.Authorization, 'abc123')
})

test('sends no Authorization header without a key', async () => {
  const api = fakeApi()
  await createClient({ fetch: api.fetch }).get('/networks/solana/pools/search')
  assert.equal('Authorization' in api.calls[0].headers, false)
})

test('defaults to the free host and accepts the paid one', () => {
  assert.equal(createClient({ fetch: fakeApi().fetch }).baseUrl, FREE_HOST)
  assert.equal(createClient({ baseUrl: `${PAID_HOST}/`, fetch: fakeApi().fetch }).baseUrl, PAID_HOST)
})

test('refuses any other base URL, so the key cannot be sent elsewhere', () => {
  for (const bad of ['http://api.dexpaprika.com', 'https://api.dexpaprika.com.evil.test', 'https://example.com']) {
    assert.throws(() => createClient({ baseUrl: bad, apiKey: 'k' }), (e) => e.code === 'invalid_base_url')
  }
})

test('refuses redirects, which would carry the key to another host', async () => {
  let seen
  await createClient({ fetch: async (u, init) => ((seen = init), json([])) }).get('/networks')
  assert.equal(seen.redirect, 'error')
})

test('waits out a short 429 once, then succeeds', async () => {
  const waits = []
  const api = fakeApi({
    '/pools/search': (u, n) => (n === 1 ? json({ error: 'rate_limited', message: 'slow down' }, 429, { 'retry-after': '3' }) : json(fixture('search-solana.json'))),
  })
  const res = await createClient({ fetch: api.fetch, sleep: async (ms) => waits.push(ms) }).get('/networks/solana/pools/search')
  assert.equal(res.results.length, 3)
  assert.deepEqual(waits, [3000])
})

test('reports a long 429 instead of hanging', async () => {
  const api = fakeApi({ '/pools/search': () => json({ message: 'monthly credits used' }, 429, { 'retry-after': '3600' }) })
  await assert.rejects(createClient({ fetch: api.fetch, sleep: noSleep }).get('/networks/solana/pools/search'), (e) => {
    assert.equal(e.code, 'rate_limited')
    assert.equal(e.retryAfter, 3600)
    assert.match(e.hint, /console\.dexpaprika\.com/)
    return true
  })
  assert.equal(api.calls.length, 1)
})

test('keeps the API error code and message (recorded 403 plan_required)', async () => {
  const api = fakeApi({ '/transactions': () => json(fixture('error-plan-required.json'), 403) })
  await assert.rejects(createClient({ fetch: api.fetch }).get('/networks/solana/pools/x/transactions'), (e) => {
    assert.ok(e instanceof DexPaprikaError)
    assert.equal(e.code, 'plan_required')
    assert.equal(e.status, 403)
    assert.equal(e.message, 'this endpoint requires a Dev or Pro plan')
    return true
  })
})

test('a 402 keeps payment_required, the tier fields and a hint (body shape from the OpenAPI spec)', async () => {
  const body = { error: 'payment_required', tier: 'free', message: 'monthly credits exhausted' }
  const api = fakeApi({ '/pools/search': () => json(body, 402) })
  await assert.rejects(createClient({ fetch: api.fetch }).get('/networks/solana/pools/search'), (e) => {
    assert.equal(e.code, 'payment_required')
    assert.equal(e.status, 402)
    assert.equal(e.toJSON().tier, 'free')
    assert.match(e.hint, /dexpaprika\.com\/api\/pricing/)
    return true
  })
})

test('plan_required passes required_tier through for agents to branch on', async () => {
  const api = fakeApi({ '/transactions': () => json(fixture('error-plan-required.json'), 403) })
  await assert.rejects(createClient({ fetch: api.fetch }).get('/networks/solana/pools/x/transactions'), (e) => {
    const j = e.toJSON()
    assert.equal(j.tier, 'keyless')
    assert.equal(j.required_tier, 'dev')
    return true
  })
})

test('an error code this version does not know still gets a hint', async () => {
  const api = fakeApi({ '/pools/search': () => json({ error: 'something_new', message: 'x' }, 409) })
  await assert.rejects(createClient({ fetch: api.fetch }).get('/networks/solana/pools/search'), (e) => /docs\.dexpaprika\.com/.test(e.hint))
})

test('turns the paid host HTML block page into a clear error', async () => {
  const fetch = async () => new Response('<!DOCTYPE html><title>blocked</title>', { status: 403, headers: { 'content-type': 'text/html' } })
  await assert.rejects(createClient({ baseUrl: PAID_HOST, fetch }).get('/networks'), (e) => e.code === 'blocked' && /DEXPAPRIKA_API_KEY/.test(e.hint))
})

test('maps a timeout and a dropped connection to their own codes', async () => {
  const timeout = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  }
  const offline = async () => {
    throw new TypeError('fetch failed')
  }
  await assert.rejects(createClient({ fetch: timeout }).get('/networks'), (e) => e.code === 'timeout')
  await assert.rejects(createClient({ fetch: offline }).get('/networks'), (e) => e.code === 'network_error')
})

test('a really slow API is cut off by the timeout', async () => {
  // AbortSignal.timeout does not keep the process alive on its own, so the fake holds a timer.
  const hang = (url, init) =>
    new Promise((_, reject) => {
      const alive = setInterval(() => {}, 10)
      init.signal.addEventListener('abort', () => (clearInterval(alive), reject(init.signal.reason)))
    })
  await assert.rejects(createClient({ fetch: hang, timeoutMs: 20 }).get('/networks'), (e) => e.code === 'timeout')
})

test('error JSON carries the docs, console and pricing links', () => {
  const body = new DexPaprikaError({ code: 'x', message: 'y' }).toJSON()
  assert.equal(body.docs_url, 'https://docs.dexpaprika.com')
  assert.equal(body.console_url, 'https://console.dexpaprika.com')
  assert.equal(body.pricing_url, 'https://dexpaprika.com/api/pricing')
})
