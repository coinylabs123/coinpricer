import { useCallback, useState } from 'react'
import { loadCurrency, saveCurrency, sanitizeCurrency } from '../utils/storage.js'

export function useCurrency() {
  const [currency, setCurrencyState] = useState(() => loadCurrency())

  const setCurrency = useCallback((code) => {
    const next = sanitizeCurrency(code)
    saveCurrency(next)
    setCurrencyState(next)
  }, [])

  return { currency, setCurrency }
}
