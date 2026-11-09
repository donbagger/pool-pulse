// A small client for the DexPaprika REST API. No dependencies: Node's own fetch.
//
// It does four things a script usually forgets: a timeout on every request, one polite
// retry on a short 429, the API key sent as the whole Authorization value, and errors that
// carry the API's own error code so a caller (or an agent) can branch on it.

import { clean } from './format.mjs'

export const FREE_HOST = 'https://api.dexpaprika.com'
export const PAID_HOST = 'https://api-pro.dexpaprika.com'

// The key is only ever sent to these two hosts, whatever DEXPAPRIKA_BASE_URL says.
const ALLOWED_HOSTS = new Set([FREE_HOST, PAID_HOST])

export const LINKS = Object.freeze({
  docs_url: 'https://docs.dexpaprika.com',
  console_url: 'https://console.dexpaprika.com',
  pricing_url: 'https://dexpaprika.com/api/pricing',
})

// A Retry-After longer than this is not worth blocking a CLI for: report it instead.
const MAX_WAIT_SECONDS = 20

export class DexPaprikaError extends Error {
  constructor({ code, message, status = null, retryAfter = null, hint = null, tier = null, requiredTier = null, param = null }) {
    super(message)
    this.name = 'DexPaprikaError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
    this.hint = hint
    // From the API's error body when it has them: the plan the request was judged
    // against, the lowest plan that would allow it, and the parameter at fault.
    this.tier = tier
    this.requiredTier = requiredTier
    this.param = param
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      status: this.status,
      retry_after: this.retryAfter,
      hint: this.hint,
      tier: this.tier,
      required_tier: this.requiredTier,
      param: this.param,
      ...LINKS,
    }
  }
}

// One per error code in the API's OpenAPI spec (ErrorBody and QuotaErrorBody), plus our own.
const HINTS = {
  rate_limited: 'Wait and try again, or add a free key from console.dexpaprika.com for a higher limit.',
  payment_required: 'The credits for this period are used up. Plans and limits: dexpaprika.com/api/pricing.',
  unauthorized: 'DEXPAPRIKA_API_KEY was refused. Copy it again from console.dexpaprika.com, the key on its own.',
  invalid_api_key: 'DEXPAPRIKA_API_KEY was refused. Copy it again from console.dexpaprika.com, the key on its own.',
  forbidden: 'This key cannot make this request. Check your plan at console.dexpaprika.com.',
  plan_required: 'This needs a paid plan. See dexpaprika.com/api/pricing.',
  preview_only: 'Your plan gets a preview of this data. See dexpaprika.com/api/pricing.',
  wrong_host: 'Free keys use https://api.dexpaprika.com. Unset DEXPAPRIKA_BASE_URL or set it to that.',
  unsupported_network: 'Run `pool-pulse --networks` for the network ids DexPaprika supports.',
  invalid_param: 'Check the flag values against `pool-pulse --help`.',
  missing_param: 'Check the flag values against `pool-pulse --help`.',
  not_found: 'DexPaprika has no data for that. Check the network id.',
  route_not_found: 'This version of pool-pulse calls an endpoint the API does not have. Update pool-pulse.',
  endpoint_removed: 'This version of pool-pulse calls a removed endpoint. Update pool-pulse.',
  internal_error: 'The API had a problem. Try again in a minute.',
  unavailable: 'The API is briefly unavailable. Try again in a minute.',
  blocked: 'The paid host only accepts a paid key. Set DEXPAPRIKA_API_KEY, or unset DEXPAPRIKA_BASE_URL.',
  timeout: 'The API did not answer in time. Try again, or raise --timeout.',
  network_error: 'Could not reach the API. Check your connection.',
}

export function resolveBaseUrl(raw) {
  const value = (raw || FREE_HOST).trim().replace(/\/+$/, '')
  if (!ALLOWED_HOSTS.has(value)) {
    throw new DexPaprikaError({
      code: 'invalid_base_url',
      message: `DEXPAPRIKA_BASE_URL must be ${FREE_HOST} or ${PAID_HOST}, got ${JSON.stringify(value)}`,
      hint: 'Paid plans use the api-pro host. Everyone else can leave DEXPAPRIKA_BASE_URL unset.',
    })
  }
  return value
}

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]   sent as the Authorization header, the key on its own
 * @param {string} [opts.baseUrl]  one of FREE_HOST or PAID_HOST
 * @param {number} [opts.timeoutMs]
 * @param {typeof fetch} [opts.fetch]  injectable for tests
 * @param {(ms: number) => Promise<void>} [opts.sleep]  injectable for tests
 */
export function createClient({
  apiKey = '',
  baseUrl,
  timeoutMs = 15_000,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  userAgent = 'pool-pulse',
} = {}) {
  const base = resolveBaseUrl(baseUrl)
  const key = apiKey.trim()
  const headers = { Accept: 'application/json', 'User-Agent': userAgent }
  if (key) headers.Authorization = key

  async function once(url) {
    let res
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      const code = timedOut ? 'timeout' : 'network_error'
      throw new DexPaprikaError({
        code,
        message: timedOut ? `No answer from ${base} within ${timeoutMs} ms` : `Request to ${base} failed: ${err?.message ?? err}`,
        hint: HINTS[code],
      })
    }
    return res
  }

  async function get(path, params = {}) {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }

    let res = await once(url)
    if (res.status === 429) {
      const wait = retryAfterSeconds(res)
      if (wait !== null && wait <= MAX_WAIT_SECONDS) {
        await sleep(wait * 1000)
        res = await once(url)
      }
    }
    if (res.ok) return res.json()
    throw await toError(res, base)
  }

  return { get, baseUrl: base, hasKey: Boolean(key) }
}

function retryAfterSeconds(res) {
  const raw = res.headers.get('retry-after')
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null
}

async function toError(res, base) {
  const status = res.status
  const type = res.headers.get('content-type') || ''
  let body = null
  if (type.includes('json')) {
    try {
      body = await res.json()
    } catch {
      body = null
    }
  }

  // The paid host answers a request without a paid key with an HTML block page, not JSON.
  if (!body && status === 403 && base === PAID_HOST) {
    return new DexPaprikaError({ code: 'blocked', status, message: `${PAID_HOST} refused the request (HTTP 403)`, hint: HINTS.blocked })
  }

  const code = (body && typeof body.error === 'string' && body.error) || (status === 429 ? 'rate_limited' : `http_${status}`)
  const message = (body && typeof body.message === 'string' && body.message) || `HTTP ${status} from ${base}`
  const field = (k) => (body && typeof body[k] === 'string' ? clean(body[k]) : null)
  return new DexPaprikaError({
    code: clean(code),
    status,
    message: clean(message),
    retryAfter: status === 429 || status === 402 ? retryAfterSeconds(res) : null,
    hint: HINTS[code] ?? (status >= 500 ? HINTS.internal_error : `See ${LINKS.docs_url} for this error.`),
    tier: field('tier'),
    requiredTier: field('required_tier'),
    param: field('param'),
  })
}
