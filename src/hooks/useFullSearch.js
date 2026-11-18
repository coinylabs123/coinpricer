import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchMarketsByIds } from '../api/coingecko.js'
import { useDebouncedValue } from './useDebouncedValue.js'
import { getCached, markNoData, putMarkets } from '../utils/marketCache.js'
import { matchCoinList, placeholderMarket, SEARCH_LIMIT } from '../utils/searchCoins.js'

export function useFullSearch({
  query,
  currency,
  excludeIds,
  loadedCoins,
  coinList,
  coinListStatus,
  coinListError,
  enabled = true,
}) {
  const debouncedQuery = useDebouncedValue(query, 450)
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const requestId = useRef(0)

  const loadedById = useMemo(() => {
    const map = new Map()
    for (const coin of loadedCoins || []) map.set(coin.id, coin)
    return map
  }, [loadedCoins])

  const excludeKey = useMemo(() => {
    if (!excludeIds) return ''
    const list = excludeIds instanceof Set ? [...excludeIds] : [...excludeIds]
    return list.join(',')
  }, [excludeIds])

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!enabled || !q) {
      requestId.current += 1
      setResults([])
      setStatus('idle')
      setError(null)
      setTruncated(false)
      return
    }

    if (coinListStatus === 'loading' && !coinList.length) {
      setResults([])
      setStatus('loading')
      setError(null)
      return
    }

    if (coinListStatus === 'error' && !coinList.length) {
      setResults([])
      setStatus('error')
      setError(coinListError)
      setTruncated(false)
      return
    }

    const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || [])
    const overLimit = matchCoinList(coinList, q, { excludeIds: exclude, limit: SEARCH_LIMIT + 1 })
    const matches = overLimit.slice(0, SEARCH_LIMIT)
    setTruncated(overLimit.length > SEARCH_LIMIT)

    if (!matches.length) {
      requestId.current += 1
      setResults([])
      setStatus('success')
      setError(null)
      return
    }

    // Build rows from (1) coins already on the page, (2) cached search prices,
    // (3) a placeholder. Ids CoinGecko has no market data for are flagged.
    const rowFor = (coin, { allowStale = false } = {}) => {
      const loaded = loadedById.get(coin.id)
      if (loaded) return { ...loaded }
      const hit = getCached(currency, coin.id)
      if (hit?.coin) return { ...hit.coin }
      if (hit?.noData) return { ...placeholderMarket(coin), _noData: true }
      if (allowStale) {
        const old = getCached(currency, coin.id, null)
        if (old?.coin) return { ...old.coin, _staleAt: old.at }
      }
      return placeholderMarket(coin)
    }

    setResults(matches.map((coin) => rowFor(coin)))

    const missing = matches
      .map((coin) => coin.id)
      .filter((cid) => !loadedById.has(cid) && !getCached(currency, cid))

    if (!missing.length) {
      requestId.current += 1
      setStatus('success')
      setError(null)
      return
    }

    const id = ++requestId.current
    setStatus('loading')
    setError(null)

    fetchMarketsByIds(currency, missing)
      .then((markets) => {
        // Cache even if the query moved on, so the work is not wasted.
        putMarkets(currency, markets)
        const got = new Set(markets.map((c) => c.id))
        markNoData(currency, missing.filter((cid) => !got.has(cid)))
        if (id !== requestId.current) return
        setResults(matches.map((coin) => rowFor(coin)))
        setStatus('success')
      })
      .catch((err) => {
        if (id !== requestId.current) return
        setResults(matches.map((coin) => rowFor(coin, { allowStale: true })))
        setError(err)
        setStatus('error')
      })
  }, [
    enabled,
    debouncedQuery,
    currency,
    excludeKey,
    excludeIds,
    loadedById,
    coinList,
    coinListStatus,
    coinListError,
  ])

  return { results, status, error, truncated, query: debouncedQuery }
}
