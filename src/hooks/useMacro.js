import { useCallback, useEffect, useState } from 'react'
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

// One shared snapshot for the whole page load. The Macro and Trend pages both
// read it, so switching tabs never re-requests any source; only the Refresh
// button (reload) fetches again. Each source settles independently so one
// failing source never blocks the others.
const store = { sources: null, updatedAt: null, run: 0 }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn())

function load() {
  const id = ++store.run
  store.sources = initial()
  store.updatedAt = null
  emit()
  const jobs = Object.entries(LOADERS).map(([key, fn]) =>
    fn()
      .then((data) => {
        if (id !== store.run) return
        store.sources = { ...store.sources, [key]: { status: 'success', data, error: null } }
        emit()
      })
      .catch((err) => {
        if (id !== store.run) return
        store.sources = { ...store.sources, [key]: { status: 'error', data: null, error: err?.message || 'Failed' } }
        emit()
      }),
  )
  Promise.allSettled(jobs).then(() => {
    if (id !== store.run) return
    store.updatedAt = new Date()
    emit()
  })
}

export function useMacro() {
  const [, force] = useState(0)

  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    if (!store.sources) load() // first consumer in this page load starts the fetch
    else fn()
    return () => listeners.delete(fn)
  }, [])

  const reload = useCallback(() => load(), [])
  return { sources: store.sources ?? initial(), updatedAt: store.updatedAt, reload }
}
