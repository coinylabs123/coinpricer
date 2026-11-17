const API = 'https://api.coingecko.com/api/v3'

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

const inflight = new Map()

async function fetchJson(url) {
  if (inflight.has(url)) return inflight.get(url)

  const request = fetchJsonOnce(url)
  inflight.set(url, request)
  try {
    return await request
  } finally {
    inflight.delete(url)
  }
}

async function fetchJsonOnce(url) {
  let res
  try {
    res = await fetch(url)
  } catch {
    throw new CoinGeckoError("Couldn't reach CoinGecko. Check your connection and try again.", {
      kind: 'network',
    })
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

export function fetchMarketsByIds(vsCurrency, ids) {
  if (!ids.length) return Promise.resolve([])
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

export function fetchCoinList() {
  return fetchJson(`${API}/coins/list`)
}
