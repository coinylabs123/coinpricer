import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMarketsByIds, fetchTopMarkets } from '../api/coingecko.js'
import { getCached, markNoData, putMarkets } from '../utils/marketCache.js'

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Fetch market data for watchlist coins outside the top 100. Uses fresh cached
// data first (e.g. a coin you just found via search), fetches the rest, and if
// CoinGecko refuses, falls back to the last saved price so the row still shows.
async function loadExtras(currency, ids, { allowCache = true } = {}) {
  const found = []
  const toFetch = []
  for (const id of ids) {
    const hit = allowCache ? getCached(currency, id) : null
    if (hit?.coin) found.push(hit.coin)
    else toFetch.push(id)
  }

  let warning = null
  if (toFetch.length) {
    try {
      const fetched = await fetchMarketsByIds(currency, toFetch)
      putMarkets(currency, fetched)
      found.push(...fetched)
      const got = new Set(fetched.map((c) => c.id))
      const noData = toFetch.filter((id) => !got.has(id))
      if (noData.length) {
        markNoData(currency, noData)
        warning = `CoinGecko has no market data for ${plural(noData.length, 'watchlist coin')} (${noData.join(', ')}).`
      }
    } catch (err) {
      const stale = []
      for (const id of toFetch) {
        const old = getCached(currency, id, null)
        if (old?.coin) stale.push({ ...old.coin, _staleAt: old.at })
      }
      found.push(...stale)
      const why =
        err?.kind === 'rate_limit'
          ? 'CoinGecko is rate-limiting requests'
          : 'CoinGecko could not be reached'
      warning = stale.length
        ? `${why}, so ${plural(stale.length, 'watchlist coin')} outside the top 100 show the last saved price. Press Refresh in a minute.`
        : `${why}, so prices for ${plural(toFetch.length, 'watchlist coin')} outside the top 100 could not load. Press Refresh in a minute.`
    }
  }
  return { coins: found, warning }
}

export function useCoins(currency, watchlist) {
  const [coins, setCoins] = useState([])
  const [status, setStatus] = useState('loading') // loading | success | error
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [warning, setWarning] = useState(null)
  const requestId = useRef(0)
  const coinsRef = useRef(coins)
  coinsRef.current = coins
  const watchlistRef = useRef(watchlist)
  watchlistRef.current = watchlist
  // Currency the current `coins` were loaded in, and ids already attempted for it,
  // so the "newly starred" effect never re-requests what load() just tried.
  const loadedCurrency = useRef(null)
  const attempted = useRef(new Set())

  const load = useCallback(async () => {
    const id = ++requestId.current
    setStatus('loading')
    setError(null)
    setWarning(null)

    try {
      const top = await fetchTopMarkets(currency)
      if (id !== requestId.current) return

      const byId = new Map(top.map((c) => [c.id, c]))
      const missing = watchlistRef.current.filter((wid) => !byId.has(wid))

      let extraWarning = null
      if (missing.length) {
        // A page load / Refresh always asks CoinGecko for fresh prices.
        const extras = await loadExtras(currency, missing, { allowCache: false })
        if (id !== requestId.current) return
        for (const coin of extras.coins) byId.set(coin.id, coin)
        extraWarning = extras.warning
      }

      attempted.current = new Set(missing)
      loadedCurrency.current = currency
      setCoins([...byId.values()])
      setWarning(extraWarning)
      setUpdatedAt(new Date())
      setStatus('success')
    } catch (err) {
      if (id !== requestId.current) return
      setError(err)
      setStatus('error')
    }
  }, [currency])

  useEffect(() => {
    load()
  }, [load])

  // A coin starred after load (from search, or an import) that is not loaded yet.
  // Search results are already in the cache, so this is usually instant.
  useEffect(() => {
    if (status !== 'success' || loadedCurrency.current !== currency) return
    const have = new Set(coinsRef.current.map((c) => c.id))
    const missing = watchlist.filter((wid) => !have.has(wid) && !attempted.current.has(wid))
    if (!missing.length) return
    for (const wid of missing) attempted.current.add(wid)

    // Not cancelled when the watchlist changes again: starring two coins in a row
    // must not drop the first coin's result. Only a currency switch discards it.
    loadExtras(currency, missing).then(({ coins: extras, warning: w }) => {
      if (loadedCurrency.current !== currency) return
      if (extras.length) {
        setCoins((current) => {
          const map = new Map(current.map((c) => [c.id, c]))
          for (const coin of extras) map.set(coin.id, coin)
          return [...map.values()]
        })
      }
      if (w) setWarning(w)
      // allow a later retry for ids that failed outright
      const got = new Set(extras.map((c) => c.id))
      for (const wid of missing) if (!got.has(wid) && !getCached(currency, wid)) attempted.current.delete(wid)
    })
  }, [watchlist, status, currency])

  return { coins, status, error, warning, updatedAt, reload: load }
}
