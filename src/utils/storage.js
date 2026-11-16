export const WATCHLIST_KEY = 'coinpricer.watchlist'
export const CURRENCY_KEY = 'coinpricer.currency'

export const SUPPORTED_CURRENCIES = [
  { code: 'usd', label: 'USD' },
  { code: 'sgd', label: 'SGD' },
  { code: 'eur', label: 'EUR' },
  { code: 'gbp', label: 'GBP' },
]

const ID_RE = /^[a-z0-9-]+$/

export function sanitizeIds(ids) {
  if (!Array.isArray(ids)) return []
  const seen = new Set()
  const out = []
  for (const raw of ids) {
    if (typeof raw !== 'string') continue
    const id = raw.trim().toLowerCase()
    if (!id || !ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function sanitizeCurrency(value, fallback = 'usd') {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SUPPORTED_CURRENCIES.some((c) => c.code === code) ? code : fallback
}

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return []
    return sanitizeIds(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveWatchlist(ids) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(sanitizeIds(ids)))
}

export function loadCurrency() {
  try {
    return sanitizeCurrency(localStorage.getItem(CURRENCY_KEY) || 'usd')
  } catch {
    return 'usd'
  }
}

export function saveCurrency(code) {
  localStorage.setItem(CURRENCY_KEY, sanitizeCurrency(code))
}
