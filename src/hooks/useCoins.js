import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMarketsByIds, fetchTopMarkets } from '../api/coingecko.js'

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

  const mergeById = useCallback((existing, incoming) => {
    const map = new Map(existing.map((c) => [c.id, c]))
    for (const coin of incoming) map.set(coin.id, coin)
    return [...map.values()]
  }, [])

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

      if (missing.length) {
        try {
          const extras = await fetchMarketsByIds(currency, missing)
          if (id !== requestId.current) return
          for (const coin of extras) byId.set(coin.id, coin)
          const stillMissing = missing.filter((wid) => !byId.has(wid))
          if (stillMissing.length) {
            setWarning(
              `Could not find ${stillMissing.length} watchlist coin${stillMissing.length === 1 ? '' : 's'} on CoinGecko.`,
            )
          }
        } catch (err) {
          if (id !== requestId.current) return
          setWarning(
            err?.kind === 'rate_limit'
              ? 'Loaded the top 100, but CoinGecko rate-limited the extra watchlist request. Try Refresh in a minute.'
              : 'Loaded the top 100, but could not fetch watchlist coins outside that list.',
          )
        }
      }

      setCoins([...byId.values()])
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

  // If the user stars a coin that is not already loaded (e.g. after import),
  // fetch just those ids. Starring a top-100 coin does not refetch.
  useEffect(() => {
    if (status !== 'success') return
    const have = new Set(coinsRef.current.map((c) => c.id))
    const missing = watchlist.filter((wid) => !have.has(wid))
    if (!missing.length) return

    let cancelled = false
    fetchMarketsByIds(currency, missing)
      .then((extras) => {
        if (cancelled) return
        setCoins((current) => mergeById(current, extras))
        const still = missing.filter((wid) => !extras.some((c) => c.id === wid) && !have.has(wid))
        if (still.length) {
          setWarning(
            `Could not find ${still.length} watchlist coin${still.length === 1 ? '' : 's'} on CoinGecko.`,
          )
        }
      })
      .catch((err) => {
        if (cancelled) return
        setWarning(
          err?.kind === 'rate_limit'
            ? 'CoinGecko rate-limited the extra watchlist request. Try Refresh in a minute.'
            : 'Could not fetch one or more watchlist coins outside the top 100.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [watchlist, status, currency, mergeById])

  return { coins, status, error, warning, updatedAt, reload: load }
}
