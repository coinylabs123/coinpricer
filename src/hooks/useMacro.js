import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDeribitOptions, fetchFearGreed, fetchGlobal, fetchPrices, fetchStablecoinSupply } from '../api/macro.js'
import {
  fetchBinancePerps,
  fetchBitgetPerps,
  fetchDeribitPerps,
  fetchDydxPerps,
  fetchGatePerps,
  fetchHyperliquidPerps,
  fetchOkxFundingHistory,
  fetchOkxPerps,
} from '../api/perps.js'
import { fetchBitgetFlow, fetchDvol, fetchGateStats, fetchHlPredicted, fetchMempool, fetchTvl } from '../api/macroExtra.js'

const LOADERS = {
  fng: fetchFearGreed,
  global: fetchGlobal,
  prices: fetchPrices,
  llama: fetchStablecoinSupply,
  deribitOptions: fetchDeribitOptions,
  okx: () => fetchOkxPerps(),
  okxHistory: () => fetchOkxFundingHistory(),
  hyperliquid: () => fetchHyperliquidPerps(),
  gate: () => fetchGatePerps(),
  bitget: () => fetchBitgetPerps(),
  deribit: () => fetchDeribitPerps(),
  dydx: () => fetchDydxPerps(),
  binance: () => fetchBinancePerps(),
  // v3 additions
  dvol: fetchDvol,
  hlPredicted: () => fetchHlPredicted(),
  gateStats: () => fetchGateStats(),
  bitgetFlow: () => fetchBitgetFlow(),
  tvl: fetchTvl,
  mempool: fetchMempool,
}

export const PERP_VENUE_KEYS = ['okx', 'hyperliquid', 'gate', 'bitget', 'deribit', 'dydx', 'binance']

const initial = () =>
  Object.fromEntries(Object.keys(LOADERS).map((k) => [k, { status: 'loading', data: null, error: null }]))

// Loads every source once (on mount / manual refresh). Each source settles
// independently so one failing source never blocks the others.
export function useMacro() {
  const [sources, setSources] = useState(initial)
  const [updatedAt, setUpdatedAt] = useState(null)
  const run = useRef(0)

  const load = useCallback(() => {
    const id = ++run.current
    setSources(initial())
    const jobs = Object.entries(LOADERS).map(([key, fn]) =>
      fn()
        .then((data) => {
          if (id !== run.current) return
          setSources((s) => ({ ...s, [key]: { status: 'success', data, error: null } }))
        })
        .catch((err) => {
          if (id !== run.current) return
          setSources((s) => ({ ...s, [key]: { status: 'error', data: null, error: err?.message || 'Failed' } }))
        }),
    )
    Promise.allSettled(jobs).then(() => {
      if (id === run.current) setUpdatedAt(new Date())
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { sources, updatedAt, reload: load }
}
