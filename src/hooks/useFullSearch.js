import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchMarketsByIds } from '../api/coingecko.js'
import { useDebouncedValue } from './useDebouncedValue.js'
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
  const debouncedQuery = useDebouncedValue(query, 300)
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const requestId = useRef(0)
  const priceCache = useRef(new Map())

  useEffect(() => {
    priceCache.current = new Map()
  }, [currency])

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

    const placeholders = matches.map((coin) => {
      const existing = loadedById.get(coin.id) || priceCache.current.get(`${currency}:${coin.id}`)
      return existing ? { ...existing } : placeholderMarket(coin)
    })
    setResults(placeholders)

    const missing = matches
      .map((coin) => coin.id)
      .filter((id) => !loadedById.has(id) && !priceCache.current.has(`${currency}:${id}`))

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
        if (id !== requestId.current) return
        for (const coin of markets) {
          priceCache.current.set(`${currency}:${coin.id}`, coin)
        }
        setResults(
          matches.map((coin) => {
            const existing =
              loadedById.get(coin.id) ||
              priceCache.current.get(`${currency}:${coin.id}`)
            return existing ? { ...existing } : placeholderMarket(coin)
          }),
        )
        setStatus('success')
      })
      .catch((err) => {
        if (id !== requestId.current) return
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
