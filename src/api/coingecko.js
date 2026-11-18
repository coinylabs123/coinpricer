const API = 'https://api.coingecko.com/api/v3'

// CoinGecko's free API allows only a handful of calls per minute per IP.
// When it throttles a browser it answers 429 *without* CORS headers, so the
// browser reports a generic "Failed to fetch" instead of a readable 429.
// We therefore treat an opaque fetch failure (while online) as a probable
// rate limit, pause all CoinGecko calls, and retry with backoff.
const RETRY_DELAYS_SECONDS = [15, 25, 25]
export const IDS_PER_REQUEST = 50

export class CoinGeckoError extends Error {
  constructor(message, { status, retryAfter, kind } = {}) {
    super(message)
    this.name = 'CoinGeckoError'
    this.status = status ?? null
    this.retryAfter = retryAfter ?? null
    this.kind = kind ?? 'unknown'
  }
}

function retryAfterSeconds(res) {
  const raw = res.headers.get('Retry-After')
  if (!raw) return null
  const asNumber = Number(raw)
  if (Number.isFinite(asNumber)) return asNumber
  const when = Date.parse(raw)
  if (Number.isNaN(when)) return null
  return Math.max(0, Math.ceil((when - Date.now()) / 1000))
}

// ---- shared rate-limit state (one cooldown for every CoinGecko call) ----
let cooldownUntil = 0
let waiting = 0
const listeners = new Set()

function emit() {
  const state = getRateLimitState()
  for (const fn of listeners) fn(state)
}

export function getRateLimitState() {
  return waiting > 0 && cooldownUntil > Date.now() ? { retryAt: cooldownUntil } : null
}

export function subscribeRateLimit(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForCooldown() {
  while (cooldownUntil > Date.now()) {
    await sleep(Math.min(1000, cooldownUntil - Date.now()))
  }
}

const inflight = new Map()

async function fetchJson(url) {
  if (inflight.has(url)) return inflight.get(url)

  const request = fetchJsonWithRetry(url)
  inflight.set(url, request)
  try {
    return await request
  } finally {
    inflight.delete(url)
  }
}

async function fetchJsonWithRetry(url) {
  for (let attempt = 0; ; attempt += 1) {
    await waitForCooldown()
    try {
      return await fetchJsonOnce(url)
    } catch (err) {
      const retryable = err.kind === 'rate_limit'
      if (!retryable || attempt >= RETRY_DELAYS_SECONDS.length) throw err
      const waitSeconds = Math.max(err.retryAfter || 0, RETRY_DELAYS_SECONDS[attempt])
      cooldownUntil = Math.max(cooldownUntil, Date.now() + waitSeconds * 1000)
      waiting += 1
      emit()
      try {
        await waitForCooldown()
      } finally {
        waiting -= 1
        emit()
      }
    }
  }
}

async function fetchJsonOnce(url) {
  let res
  try {
    res = await fetch(url)
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    if (offline) {
      throw new CoinGeckoError("You appear to be offline. Check your connection and try again.", {
        kind: 'network',
      })
    }
    throw new CoinGeckoError(
      'CoinGecko is rate-limiting requests right now (its free API allows only a few calls a minute). Wait a minute and try again.',
      { kind: 'rate_limit' },
    )
  }

  if (res.status === 429) {
    const retryAfter = retryAfterSeconds(res)
    const wait = retryAfter ? ` Wait about ${retryAfter} second${retryAfter === 1 ? '' : 's'} and retry.` : ' Please wait a minute and try again.'
    throw new CoinGeckoError(
      `CoinGecko is rate-limiting requests right now.${wait}`,
      { status: 429, retryAfter, kind: 'rate_limit' },
    )
  }

  if (!res.ok) {
    throw new CoinGeckoError(
      `CoinGecko returned an error (${res.status}). Please try again.`,
      { status: res.status, kind: 'http' },
    )
  }

  return res.json()
}

function marketsUrl(params) {
  return `${API}/coins/markets?${params.toString()}`
}

export function fetchTopMarkets(vsCurrency) {
  const params = new URLSearchParams({
    vs_currency: vsCurrency,
    order: 'market_cap_desc',
    per_page: '100',
    page: '1',
    price_change_percentage: '24h',
    sparkline: 'false',
  })
  return fetchJson(marketsUrl(params))
}

function marketsByIdsChunk(vsCurrency, ids) {
  const params = new URLSearchParams({
    vs_currency: vsCurrency,
    ids: ids.join(','),
    order: 'market_cap_desc',
    per_page: String(Math.min(250, ids.length)),
    page: '1',
    price_change_percentage: '24h',
    sparkline: 'false',
  })
  return fetchJson(marketsUrl(params))
}

// Fetches market data for any CoinGecko ids, in chunks so the URL stays short.
// Ids CoinGecko has no market data for are simply absent from the result.
export async function fetchMarketsByIds(vsCurrency, ids) {
  const unique = [...new Set(ids.filter(Boolean))].sort()
  if (!unique.length) return []
  const out = []
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = await marketsByIdsChunk(vsCurrency, unique.slice(i, i + IDS_PER_REQUEST))
    if (Array.isArray(chunk)) out.push(...chunk)
  }
  return out
}

export function fetchCoinList() {
  return fetchJson(`${API}/coins/list`)
}
