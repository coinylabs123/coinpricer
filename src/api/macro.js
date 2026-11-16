// Snapshot fetchers for the Macro tab.
// Every source is free, keyless and CORS-enabled, and is requested once per
// page load (or manual Refresh). No price-history / OHLC endpoints are used.

export const SOURCES = {
  fng: {
    label: 'alternative.me Fear & Greed',
    url: 'https://api.alternative.me/fng/?limit=30',
    home: 'https://alternative.me/crypto/fear-and-greed-index/',
  },
  global: {
    label: 'CoinGecko /global',
    url: 'https://api.coingecko.com/api/v3/global',
    home: 'https://www.coingecko.com/en/global-charts',
  },
  prices: {
    label: 'CoinGecko /simple/price',
    // Current prices + market caps only (no history).
    url:
      'https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_market_cap=true&ids=' +
      [
        'bitcoin', 'ethereum', 'solana', 'ripple', 'dogecoin', 'binancecoin', 'hyperliquid', 'chainlink',
        'tether', 'usd-coin', 'usds', 'dai', 'ethena-usde', 'paypal-usd', 'first-digital-usd',
      ].join(','),
    home: 'https://www.coingecko.com',
  },
  llama: {
    label: 'DefiLlama stablecoins',
    url: 'https://stablecoins.llama.fi/stablecoins?includePrices=false',
    home: 'https://defillama.com/stablecoins',
  },
  perps: {
    label: 'Perp venues (OKX, Hyperliquid, Gate.io, Bitget, Deribit, dYdX)',
    home: 'https://www.coinglass.com/FundingRate',
  },
  okxHistory: {
    label: 'OKX funding-rate history',
    home: 'https://www.okx.com/trade-market/funding/swap',
  },
  deribitFutures: {
    label: 'Deribit BTC dated futures',
    home: 'https://www.deribit.com/futures/BTC',
  },
  deribitOptions: {
    label: 'Deribit BTC options book summary',
    url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
    home: 'https://www.deribit.com',
  },
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export const STABLE_IDS = ['tether', 'usd-coin', 'usds', 'dai', 'ethena-usde', 'paypal-usd', 'first-digital-usd']

async function getJson(url) {
  let res
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Network/CORS error')
  }
  if (res.status === 429) throw new Error('Rate-limited (429) — try again in a minute')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchFearGreed() {
  const json = await getJson(SOURCES.fng.url)
  const rows = (json?.data ?? [])
    .map((d) => ({ value: num(d.value), label: d.value_classification, ts: num(d.timestamp) }))
    .filter((d) => d.value != null)
  if (!rows.length) throw new Error('No data')
  return rows // newest first
}

export async function fetchGlobal() {
  const json = await getJson(SOURCES.global.url)
  const d = json?.data
  if (!d?.total_market_cap?.usd) throw new Error('No data')
  return {
    totalMcapUsd: num(d.total_market_cap.usd),
    btcDom: num(d.market_cap_percentage?.btc),
    ethDom: num(d.market_cap_percentage?.eth),
    mcapChange24h: num(d.market_cap_change_percentage_24h_usd),
  }
}

export async function fetchPrices() {
  const json = await getJson(SOURCES.prices.url)
  if (!json?.bitcoin?.usd) throw new Error('No data')
  return json
}

export async function fetchStablecoinSupply() {
  const json = await getJson(SOURCES.llama.url)
  const assets = json?.peggedAssets ?? []
  const sum = (key) => assets.reduce((acc, a) => acc + (num(a?.[key]?.peggedUSD) ?? 0), 0)
  const now = sum('circulating')
  const week = sum('circulatingPrevWeek')
  const month = sum('circulatingPrevMonth')
  if (!now) throw new Error('No data')
  return {
    totalUsd: now,
    change7d: week ? (now / week - 1) * 100 : null,
    change30d: month ? (now / month - 1) * 100 : null,
  }
}

export async function fetchDeribitOptions() {
  const json = await getJson(SOURCES.deribitOptions.url)
  const rows = json?.result ?? []
  let puts = 0
  let calls = 0
  const byExpiry = new Map()
  const now = Date.now()
  for (const r of rows) {
    const oi = num(r.open_interest) ?? 0
    if (r.instrument_name?.endsWith('-P')) puts += oi
    else if (r.instrument_name?.endsWith('-C')) calls += oi
    // BTC-20NOV26-64000-P
    const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([PC])$/.exec(r.instrument_name ?? '')
    const month = m ? MONTHS.indexOf(m[2]) : -1
    if (!m || month < 0) continue
    const expiry = Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8)
    const dte = (expiry - now) / 86_400_000
    if (!byExpiry.has(expiry)) byExpiry.set(expiry, { dte, legs: [] })
    byExpiry.get(expiry).legs.push({
      strike: Number(m[4]),
      type: m[5],
      iv: num(r.mark_iv),
      underlying: num(r.underlying_price),
    })
  }
  if (!calls) throw new Error('No data')

  // ~10%-OTM skew: put IV at ~0.9x spot minus call IV at ~1.1x spot, on the
  // expiry closest to 30 days (between 7 and 60 days out).
  let skew = null
  let best = null
  for (const e of byExpiry.values()) {
    if (e.dte < 7 || e.dte > 60) continue
    if (!best || Math.abs(e.dte - 30) < Math.abs(best.dte - 30)) best = e
  }
  if (best) {
    const spot = best.legs.find((l) => l.underlying)?.underlying
    const pick = (type, target) =>
      best.legs
        .filter((l) => l.type === type && l.iv)
        .sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0]
    if (spot) {
      const put = pick('P', spot * 0.9)
      const call = pick('C', spot * 1.1)
      if (put && call) {
        skew = { dte: best.dte, putStrike: put.strike, callStrike: call.strike, putIv: put.iv, callIv: call.iv, skew: put.iv - call.iv }
      }
    }
  }
  return { putOi: puts, callOi: calls, pcr: puts / calls, instruments: rows.length, skew }
}
