export const COIN_LIST_TTL_MS = 24 * 60 * 60 * 1000
export const COIN_LIST_STORAGE_KEY = 'coinpricer.coinList'

const DB_NAME = 'coinpricer'
const DB_VERSION = 1
const STORE = 'kv'
const IDB_KEY = 'coinList'

export function isCoinListStale(fetchedAt, now = Date.now()) {
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return true
  return now - fetchedAt >= COIN_LIST_TTL_MS
}

export function normalizeCoinList(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      symbol: typeof item.symbol === 'string' ? item.symbol : '',
      name: typeof item.name === 'string' ? item.name : id,
    })
  }
  return out
}

function pack(coins, fetchedAt) {
  return {
    v: 1,
    fetchedAt,
    coins: coins.map((c) => [c.id, c.symbol, c.name]),
  }
}

function unpack(payload) {
  if (!payload || typeof payload !== 'object') return null
  const fetchedAt = Number(payload.fetchedAt)
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
  let coins
  if (Array.isArray(payload.coins) && payload.coins.length && Array.isArray(payload.coins[0])) {
    coins = normalizeCoinList(payload.coins.map(([id, symbol, name]) => ({ id, symbol, name })))
  } else {
    coins = normalizeCoinList(payload.coins)
  }
  if (!coins.length) return null
  return { coins, fetchedAt }
}

function isQuotaError(err) {
  if (!err) return false
  const name = err.name || ''
  const message = String(err.message || err)
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(message)
  )
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB'))
  })
}

function idbGet(key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(key)
        req.onsuccess = () => {
          db.close()
          resolve(req.result ?? null)
        }
        req.onerror = () => {
          db.close()
          reject(req.error || new Error('IndexedDB read failed'))
        }
      }),
  )
}

function idbSet(key, value) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const req = tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error || req.error || new Error('IndexedDB write failed'))
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error || req.error || new Error('IndexedDB write aborted'))
        }
      }),
  )
}

function readLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(COIN_LIST_STORAGE_KEY)
    if (!raw) return null
    return unpack(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeLocalStorage(payload) {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage is not available')
  }
  localStorage.setItem(COIN_LIST_STORAGE_KEY, JSON.stringify(payload))
}

export async function loadCachedCoinList() {
  try {
    const fromIdb = unpack(await idbGet(IDB_KEY))
    if (fromIdb) return { ...fromIdb, source: 'indexeddb' }
  } catch {
    // Fall through to localStorage.
  }
  const fromLs = readLocalStorage()
  if (fromLs) return { ...fromLs, source: 'localStorage' }
  return null
}

export async function saveCoinList(coins, fetchedAt = Date.now()) {
  const normalized = normalizeCoinList(coins)
  if (!normalized.length) return { saved: false, source: null, quotaExceeded: false }
  const payload = pack(normalized, fetchedAt)

  try {
    await idbSet(IDB_KEY, payload)
    return { saved: true, source: 'indexeddb', quotaExceeded: false }
  } catch (err) {
    const quota = isQuotaError(err)
    try {
      writeLocalStorage(payload)
      return { saved: true, source: 'localStorage', quotaExceeded: quota }
    } catch (lsErr) {
      return {
        saved: false,
        source: null,
        quotaExceeded: quota || isQuotaError(lsErr),
      }
    }
  }
}
