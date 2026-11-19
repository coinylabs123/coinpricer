// Extra snapshot fetchers added for the Ultra-short horizon and the
// "additional signals" (v3). Every endpoint below was probed with a real
// request + CORS check (Access-Control-Allow-Origin present) before use.
// No price-history / OHLC endpoints are used: the series fetched here are
// funding, open interest, liquidations, taker flow, account ratios,
// implied volatility (DVOL), DeFi TVL and BTC hashrate — not prices.
//
// Dropped after probing (see Macro page fine print):
//   - OKX rubik/stat/* (OI history, taker volume, long/short): no CORS header.
//   - DefiLlama /overview/dexs: ~2.5 MB per load (≈0.5 MB gzipped) — too heavy.
//   - DefiLlama /overview/derivatives: HTTP 402 (paid plan only).
//   - DefiLlama stablecoin flows by exchange: not offered on the free API.
//   - Binance 451, Bybit 403, BitMEX 403 (region-blocked) — but Binance and
//     Bybit *predicted funding* is available via Hyperliquid's predictedFundings.

import { PERP_COINS } from './perps.js'

export const EXTRA_SOURCES = {
  dvol: { label: 'Deribit DVOL index', home: 'https://www.deribit.com/statistics/BTC/volatility-index' },
  hlPredicted: { label: 'Hyperliquid predictedFundings (Binance · Bybit · HL)', home: 'https://app.hyperliquid.xyz/fundingComparison' },
  gateStats: { label: 'Gate.io contract stats (OI, liquidations, taker L/S)', home: 'https://www.gate.io/futures/USDT' },
  bitgetFlow: { label: 'Bitget taker buy/sell & account long/short', home: 'https://www.bitget.com/futures/usdt' },
  tvl: { label: 'DefiLlama total DeFi TVL', home: 'https://defillama.com' },
  mempool: { label: 'mempool.space mining stats', home: 'https://mempool.space/mining' },
}

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function getJson(url, init) {
  let res
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('Network/CORS error')
  }
  if (res.status === 429) throw new Error('Rate-limited (429)')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Deribit DVOL (30-day implied-vol index) for BTC and ETH, hourly over ~48h.
// Implied volatility, not price. Returns current value and 24h change.
export async function fetchDvol() {
  const end = Date.now()
  const start = end - 50 * 3_600_000
  const one = async (ccy) => {
    const j = await getJson(
      `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${ccy}&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`,
    )
    const rows = (j?.result?.data ?? []).map((r) => ({ t: r[0], close: num(r[4]) })).filter((r) => r.close != null)
    if (!rows.length) return null
    rows.sort((a, b) => a.t - b.t)
    const now = rows[rows.length - 1]
    const target = now.t - 24 * 3_600_000
    const ago = rows.reduce((best, r) => (Math.abs(r.t - target) < Math.abs(best.t - target) ? r : best), rows[0])
    const hi = Math.max(...rows.map((r) => r.close))
    const lo = Math.min(...rows.map((r) => r.close))
    return { now: now.close, ago24h: ago.close, change24hPct: (now.close / ago.close - 1) * 100, hi48h: hi, lo48h: lo }
  }
  const [btc, eth] = await Promise.all([one('BTC').catch(() => null), one('ETH').catch(() => null)])
  if (!btc && !eth) throw new Error('No data')
  return { BTC: btc, ETH: eth }
}

// Hyperliquid predictedFundings: next predicted funding on Binance, Bybit and
// Hyperliquid per coin (one POST, ~64 KB). Normalised to 8h-equivalent decimals.
const HL_VENUES = { BinPerp: 'binance', BybitPerp: 'bybit', HlPerp: 'hyperliquid' }
export async function fetchHlPredicted(coins = PERP_COINS) {
  const json = await getJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'predictedFundings' }),
  })
  const out = {}
  for (const [coin, venues] of json ?? []) {
    if (!coins.includes(coin)) continue
    const row = {}
    for (const [v, d] of venues ?? []) {
      const key = HL_VENUES[v]
      const rate = num(d?.fundingRate)
      const h = num(d?.fundingIntervalHours) || 8
      if (key && rate != null) row[key] = { rate8h: (rate * 8) / h, intervalH: h, next: num(d?.nextFundingTime) }
    }
    if (Object.keys(row).length) out[coin] = row
  }
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// Gate.io hourly contract stats (24 rows ≈ last 24h) per coin:
// open-interest change, liquidations by side, taker long/short ratio,
// account long/short and top-trader position ratio. The rows also carry a
// mark_price field, which is deliberately ignored (no price history used).
export async function fetchGateStats(coins = PERP_COINS) {
  const rows = await Promise.all(
    coins.map((c) =>
      getJson(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${c}_USDT&interval=1h&limit=25`).catch(() => null),
    ),
  )
  const out = {}
  coins.forEach((c, i) => {
    const data = (Array.isArray(rows[i]) ? rows[i] : []).slice().sort((a, b) => a.time - b.time)
    if (data.length < 4) return
    const first = data[0]
    const last = data[data.length - 1]
    const oiNow = num(last.open_interest_usd)
    const oiThen = num(first.open_interest_usd)
    const sum = (k) => data.reduce((a, r) => a + (num(r[k]) ?? 0), 0)
    const takerL = sum('long_taker_size')
    const takerS = sum('short_taker_size')
    out[c] = {
      hours: (last.time - first.time) / 3600,
      oiUsd: oiNow,
      oiChangePct: oiNow && oiThen ? (oiNow / oiThen - 1) * 100 : null,
      longLiqUsd: sum('long_liq_usd'),
      shortLiqUsd: sum('short_liq_usd'),
      takerRatio: takerS ? takerL / takerS : null,
      accountLsr: num(last.lsr_account),
      accountLsrThen: num(first.lsr_account),
      topLsrSize: num(last.top_lsr_size),
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// Bitget hourly taker buy/sell volume and account long/short ratio (BTC, ETH).
export async function fetchBitgetFlow(coins = ['BTC', 'ETH']) {
  const base = 'https://api.bitget.com/api/v2/mix/market'
  const res = await Promise.all(
    coins.flatMap((c) => [
      getJson(`${base}/taker-buy-sell?symbol=${c}USDT&period=1h`).catch(() => null),
      getJson(`${base}/account-long-short?symbol=${c}USDT&period=1h`).catch(() => null),
    ]),
  )
  const out = {}
  const dayAgo = Date.now() - 24 * 3_600_000
  coins.forEach((c, i) => {
    const taker = (res[i * 2]?.data ?? []).filter((r) => num(r.ts) >= dayAgo)
    const ls = (res[i * 2 + 1]?.data ?? []).map((r) => ({ ts: num(r.ts), r: num(r.longShortAccountRatio) })).filter((r) => r.r != null).sort((a, b) => a.ts - b.ts)
    const buy = taker.reduce((a, r) => a + (num(r.buyVolume) ?? 0), 0)
    const sell = taker.reduce((a, r) => a + (num(r.sellVolume) ?? 0), 0)
    const lsNow = ls[ls.length - 1]?.r ?? null
    const lsThen = ls.find((r) => r.ts >= dayAgo)?.r ?? ls[0]?.r ?? null
    if (!sell && lsNow == null) return
    out[c] = {
      takerRatio: sell ? buy / sell : null,
      takerHours: taker.length,
      accountLsr: lsNow,
      accountLsrChangePct: lsNow != null && lsThen ? (lsNow / lsThen - 1) * 100 : null,
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// DefiLlama total DeFi TVL (daily series of TVL in USD, ~120 KB). TVL, not price.
export async function fetchTvl() {
  const rows = await getJson('https://api.llama.fi/v2/historicalChainTvl')
  if (!Array.isArray(rows) || rows.length < 31) throw new Error('No data')
  const at = (daysAgo) => num(rows[rows.length - 1 - daysAgo]?.tvl)
  const now = at(0)
  return {
    tvl: now,
    change7d: at(7) ? (now / at(7) - 1) * 100 : null,
    change30d: at(30) ? (now / at(30) - 1) * 100 : null,
  }
}

// mempool.space: next difficulty adjustment estimate + 1-month hashrate trend.
export async function fetchMempool() {
  const [adj, hr] = await Promise.all([
    getJson('https://mempool.space/api/v1/difficulty-adjustment').catch(() => null),
    getJson('https://mempool.space/api/v1/mining/hashrate/1m').catch(() => null),
  ])
  if (!adj && !hr) throw new Error('Network/CORS error')
  let hashChange = null
  const hs = (hr?.hashrates ?? []).map((h) => num(h.avgHashrate)).filter(Boolean)
  if (hs.length >= 14) {
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    hashChange = (avg(hs.slice(-7)) / avg(hs.slice(0, 7)) - 1) * 100
  }
  return {
    difficultyChangePct: num(adj?.difficultyChange),
    progressPct: num(adj?.progressPercent),
    retargetAt: num(adj?.estimatedRetargetDate),
    previousRetargetPct: num(adj?.previousRetarget),
    hashrateEh: num(hr?.currentHashrate) ? num(hr.currentHashrate) / 1e18 : null,
    hashChange30dPct: hashChange,
  }
}
