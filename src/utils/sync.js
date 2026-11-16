import { sanitizeCurrency, sanitizeIds } from './storage.js'

export const EXPORT_VERSION = 1

function parsePairString(raw) {
  const params = new URLSearchParams(raw)
  const w = params.get('w')
  if (!w) return null
  let ids = []
  let currency = params.get('c') || params.get('currency')

  // Human-readable: #w=bitcoin,ethereum&c=sgd
  // or a single base64url JSON blob in w
  if (/^[A-Za-z0-9-_]+$/.test(w) && !w.includes(',') && w.length > 24) {
    try {
      const padded = w.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (w.length % 4)) % 4)
      const parsed = JSON.parse(atob(padded))
      ids = sanitizeIds(parsed.watchlist || parsed.ids || parsed.coins || [])
      currency = parsed.currency || currency
    } catch {
      ids = sanitizeIds(w.split(','))
    }
  } else {
    ids = sanitizeIds(w.split(','))
  }

  if (!ids.length) return null
  return {
    watchlist: ids,
    currency: currency ? sanitizeCurrency(currency, null) : null,
    source: 'link',
  }
}

export function parseSyncPayloadFromLocation(loc = window.location) {
  const fromSearch = parsePairString(loc.search.startsWith('?') ? loc.search.slice(1) : loc.search)
  if (fromSearch) return fromSearch
  const hash = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash
  if (!hash) return null
  return parsePairString(hash)
}

export function buildSyncHash(watchlist, currency) {
  const ids = sanitizeIds(watchlist)
  const params = new URLSearchParams()
  params.set('w', ids.join(','))
  if (currency) params.set('c', sanitizeCurrency(currency))
  // URLSearchParams encodes commas; keep them readable
  return `#${params.toString().replace(/%2C/gi, ',')}`
}

export function buildSyncUrl(watchlist, currency, loc = window.location) {
  return `${loc.origin}${loc.pathname}${buildSyncHash(watchlist, currency)}`
}

export function cleanSyncFromUrl(loc = window.location) {
  const searchParams = new URLSearchParams(loc.search)
  searchParams.delete('w')
  searchParams.delete('c')
  searchParams.delete('currency')
  const search = searchParams.toString()
  const hashRaw = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash
  const hashParams = new URLSearchParams(hashRaw)
  const hadSyncInHash = hashParams.has('w') || hashParams.has('c')
  if (hadSyncInHash) {
    hashParams.delete('w')
    hashParams.delete('c')
    hashParams.delete('currency')
  }
  const nextHash = hadSyncInHash && hashParams.toString()
    ? `#${hashParams.toString()}`
    : hadSyncInHash
      ? ''
      : loc.hash
  const next = `${loc.pathname}${search ? `?${search}` : ''}${nextHash}`
  window.history.replaceState(null, '', next)
}

export function serializeWatchlistFile(watchlist, currency) {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      app: 'coinpricer',
      exportedAt: new Date().toISOString(),
      currency: sanitizeCurrency(currency),
      watchlist: sanitizeIds(watchlist),
    },
    null,
    2,
  )
}

export function parseWatchlistFile(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('That file does not look like a CoinPricer watchlist.')
  }
  const ids = sanitizeIds(data.watchlist || data.ids || data.coins || [])
  if (!ids.length) {
    throw new Error('No valid coin ids were found in that file.')
  }
  return {
    watchlist: ids,
    currency: data.currency ? sanitizeCurrency(data.currency, null) : null,
    source: 'file',
  }
}

export function downloadWatchlistFile(watchlist, currency) {
  const blob = new Blob([serializeWatchlistFile(watchlist, currency)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'coinpricer-watchlist.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
