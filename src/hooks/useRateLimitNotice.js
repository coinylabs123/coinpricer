import { useEffect, useState } from 'react'
import { getRateLimitState, subscribeRateLimit } from '../api/coingecko.js'

// Seconds until the next automatic CoinGecko retry, or null when not waiting.
export function useRateLimitNotice() {
  const [state, setState] = useState(() => getRateLimitState())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => subscribeRateLimit(setState), [])

  useEffect(() => {
    if (!state) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state])

  if (!state) return null
  return Math.max(0, Math.ceil((state.retryAt - now) / 1000))
}
