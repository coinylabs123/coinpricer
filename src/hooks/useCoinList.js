import { useEffect, useState } from 'react'
import { fetchCoinList } from '../api/coingecko.js'
import {
  isCoinListStale,
  loadCachedCoinList,
  normalizeCoinList,
  saveCoinList,
} from '../utils/coinListCache.js'

export function useCoinList() {
  const [coins, setCoins] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const cached = await loadCachedCoinList()
      if (cancelled) return cached

      if (cached?.coins?.length) {
        setCoins(cached.coins)
        setFetchedAt(cached.fetchedAt)
        setStatus('ready')
        setError(null)
        if (!isCoinListStale(cached.fetchedAt)) return cached
      }
      return cached
    }

    async function refresh(hasCache) {
      if (hasCache) setRefreshing(true)
      else {
        setStatus('loading')
        setError(null)
      }

      try {
        const raw = await fetchCoinList()
        if (cancelled) return
        const list = normalizeCoinList(raw)
        const at = Date.now()
        setCoins(list)
        setFetchedAt(at)
        setStatus('ready')
        setError(null)
        await saveCoinList(list, at)
      } catch (err) {
        if (cancelled) return
        if (!hasCache) {
          setError(err)
          setStatus('error')
        }
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }

    hydrate()
      .then((cached) => {
        if (cancelled) return
        const hasCache = Boolean(cached?.coins?.length)
        const stale = !hasCache || isCoinListStale(cached.fetchedAt)
        if (stale) return refresh(hasCache)
      })
      .catch(() => {
        if (!cancelled) refresh(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { coins, status, error, fetchedAt, refreshing }
}
