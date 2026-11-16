import { useCallback, useState } from 'react'
import { loadWatchlist, saveWatchlist, sanitizeIds } from '../utils/storage.js'

export function useWatchlist() {
  const [watchlist, setWatchlistState] = useState(() => loadWatchlist())

  const persist = useCallback((ids) => {
    const next = sanitizeIds(ids)
    saveWatchlist(next)
    setWatchlistState(next)
    return next
  }, [])

  const toggle = useCallback((id) => {
    setWatchlistState((current) => {
      const has = current.includes(id)
      const next = has ? current.filter((x) => x !== id) : [...current, id]
      saveWatchlist(next)
      return next
    })
  }, [])

  const merge = useCallback((ids) => {
    setWatchlistState((current) => {
      const next = sanitizeIds([...current, ...ids])
      saveWatchlist(next)
      return next
    })
  }, [])

  const replace = useCallback((ids) => persist(ids), [persist])

  const isWatched = useCallback((id) => watchlist.includes(id), [watchlist])

  return { watchlist, toggle, merge, replace, isWatched }
}
