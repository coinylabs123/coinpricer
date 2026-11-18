// Shared price cache for coins outside the top 100, keyed by currency + id.
// Search results and watchlist extras both read and write it, so starring a
// coin you just searched for does not trigger another CoinGecko call, and the
// last known price can be shown if CoinGecko is rate-limiting.
const STORAGE_KEY = 'coinpricer:marketCache:v1'
const MAX_ENTRIES = 400
export const FRESH_MS = 5 * 60 * 1000

const entries = new Map() // key -> { coin, at } | { noData: true, at }
let loaded = false

const keyOf = (currency, id) => `${currency}:${id}`

function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    for (const [key, value] of Object.entries(parsed || {})) {
      if (value && typeof value.at === 'number' && value.coin?.id) entries.set(key, value)
    }
  } catch {
    // ignore corrupt cache
  }
}

function persist() {
  try {
    const sorted = [...entries.entries()]
      .filter(([, v]) => v.coin)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(sorted)))
  } catch {
    // storage full or unavailable; the in-memory cache still works
  }
}

export function putMarkets(currency, coins) {
  ensureLoaded()
  const at = Date.now()
  for (const coin of coins || []) {
    if (coin?.id) entries.set(keyOf(currency, coin.id), { coin, at })
  }
  persist()
}

// CoinGecko lists some ids (inactive or delisted coins) that have no market data.
export function markNoData(currency, ids) {
  ensureLoaded()
  const at = Date.now()
  for (const id of ids || []) entries.set(keyOf(currency, id), { noData: true, at })
}

// Returns { coin, at } / { noData, at } if present and younger than maxAgeMs.
export function getCached(currency, id, maxAgeMs = FRESH_MS) {
  ensureLoaded()
  const entry = entries.get(keyOf(currency, id))
  if (!entry) return null
  if (maxAgeMs != null && Date.now() - entry.at > maxAgeMs) return null
  return entry
}

