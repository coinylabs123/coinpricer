// Perpetual-futures snapshot fetchers (funding, open interest, mark/index).
// All endpoints are public, keyless and CORS-enabled. No price history is
// requested — only current snapshots, plus OKX's *funding-rate* history
// (funding, not price) for 24h / 7d averages.
//
// Every venue is normalised to:
//   { venue, funding8h, intervalH, nextFundingTime, predicted8h, oiUsd, mark, index, premium, note }
// where funding8h / predicted8h are decimals expressed as an 8-hour-equivalent rate,
// premium is (mark - index) / index as a decimal.

// Not every venue lists every coin (e.g. XMR is not on OKX or Deribit); missing venues are skipped.
export const PERP_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'XMR', 'ZEC']

export const COIN_GECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  BNB: 'binancecoin',
  HYPE: 'hyperliquid',
  LINK: 'chainlink',
  XMR: 'monero',
  ZEC: 'zcash',
}

export const VENUES = {
  okx: { label: 'OKX', home: 'https://www.okx.com/trade-swap' },
  hyperliquid: { label: 'Hyperliquid', home: 'https://app.hyperliquid.xyz/trade' },
  gate: { label: 'Gate.io', home: 'https://www.gate.io/futures/USDT' },
  bitget: { label: 'Bitget', home: 'https://www.bitget.com/futures/usdt' },
  deribit: { label: 'Deribit', home: 'https://www.deribit.com' },
  dydx: { label: 'dYdX v4', home: 'https://dydx.trade' },
  binance: { label: 'Binance', home: 'https://www.binance.com/en/futures' },
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

const premium = (mark, index) => (mark && index ? mark / index - 1 : null)
const nextHour = () => {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d.getTime() + 3_600_000
}

// ---------- OKX ----------
export async function fetchOkxPerps(coins = PERP_COINS) {
  const [oiJson, ...fund] = await Promise.all([
    getJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP'),
    ...coins.map((c) =>
      getJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${c}-USDT-SWAP`).catch(() => null),
    ),
  ])
  const oiById = new Map((oiJson?.data ?? []).map((r) => [r.instId, num(r.oiUsd)]))
  const out = {}
  coins.forEach((c, i) => {
    const r = fund[i]?.data?.[0]
    const usdt = oiById.get(`${c}-USDT-SWAP`) ?? null
    const inverse = oiById.get(`${c}-USD-SWAP`) ?? null
    const oiUsd = usdt == null && inverse == null ? null : (usdt ?? 0) + (inverse ?? 0)
    if (!r && oiUsd == null) return
    const t = num(r?.fundingTime)
    const n = num(r?.nextFundingTime)
    const intervalH = t && n && n > t ? (n - t) / 3_600_000 : 8
    const rate = num(r?.fundingRate)
    const next = num(r?.nextFundingRate)
    out[c] = {
      venue: 'okx',
      funding8h: rate == null ? null : (rate * 8) / intervalH,
      intervalH,
      nextFundingTime: t,
      predicted8h: next == null ? null : (next * 8) / intervalH,
      oiUsd,
      premium: num(r?.premium),
      note: 'USDT + USD swaps OI; rate = current period, settles at next funding time',
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// OKX funding-rate history (funding, not price): 24h and 7d averages, 8h-normalised.
export async function fetchOkxFundingHistory(coins = PERP_COINS) {
  const now = Date.now()
  const rows = await Promise.all(
    coins.map((c) =>
      getJson(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${c}-USDT-SWAP&limit=60`).catch(() => null),
    ),
  )
  const out = {}
  coins.forEach((c, i) => {
    const data = (rows[i]?.data ?? [])
      .map((r) => ({ t: num(r.fundingTime), rate: num(r.realizedRate ?? r.fundingRate) }))
      .filter((r) => r.t && r.rate != null)
      .sort((a, b) => b.t - a.t)
    if (data.length < 2) return
    const norm = data.map((r, idx) => {
      const older = data[idx + 1]
      const h = older ? (r.t - older.t) / 3_600_000 : (data[idx - 1] ? (data[idx - 1].t - r.t) / 3_600_000 : 8)
      return { t: r.t, rate8h: (r.rate * 8) / (h || 8) }
    })
    const avg = (since) => {
      const xs = norm.filter((r) => r.t >= since).map((r) => r.rate8h)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
    }
    out[c] = {
      avg24h: avg(now - 24 * 3_600_000),
      avg7d: avg(now - 7 * 24 * 3_600_000),
      samples: norm.length,
      last: norm[0]?.rate8h ?? null, // latest settled print (v3)
      lastTime: norm[0]?.t ?? null,
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// ---------- Hyperliquid ----------
export async function fetchHyperliquidPerps(coins = PERP_COINS) {
  const json = await getJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  })
  const [meta, ctxs] = json ?? []
  const out = {}
  ;(meta?.universe ?? []).forEach((u, i) => {
    if (!coins.includes(u.name) || u.isDelisted) return
    const c = ctxs?.[i]
    if (!c) return
    const mark = num(c.markPx)
    const oracle = num(c.oraclePx)
    const f1h = num(c.funding)
    out[u.name] = {
      venue: 'hyperliquid',
      funding8h: f1h == null ? null : f1h * 8,
      intervalH: 1,
      nextFundingTime: nextHour(),
      predicted8h: f1h == null ? null : f1h * 8,
      oiUsd: num(c.openInterest) != null && mark ? num(c.openInterest) * mark : null,
      mark,
      index: oracle,
      premium: premium(mark, oracle),
      funding1h: f1h,
      maxLeverage: num(u.maxLeverage),
      volUsd: num(c.dayNtlVlm),
      note: 'Hourly funding (shown ×8); OI × mark',
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// ---------- Gate.io ----------
export async function fetchGatePerps(coins = PERP_COINS) {
  const rows = await Promise.all(
    coins.map((c) => getJson(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${c}_USDT`).catch(() => null)),
  )
  const out = {}
  coins.forEach((c, i) => {
    const r = rows[i]
    if (!r?.name) return
    const intervalH = (num(r.funding_interval) ?? 28800) / 3600
    const rate = num(r.funding_rate)
    const ind = num(r.funding_rate_indicative)
    const mark = num(r.mark_price)
    const index = num(r.index_price)
    const size = num(r.position_size)
    const mult = num(r.quanto_multiplier)
    out[c] = {
      venue: 'gate',
      funding8h: rate == null ? null : (rate * 8) / intervalH,
      intervalH,
      nextFundingTime: num(r.funding_next_apply) ? num(r.funding_next_apply) * 1000 : null,
      predicted8h: ind == null ? null : (ind * 8) / intervalH,
      oiUsd: size != null && mult != null && mark ? size * mult * mark : null,
      mark,
      index,
      premium: premium(mark, index),
      note: 'USDT-margined; predicted = indicative rate',
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

// ---------- Bitget ----------
export async function fetchBitgetPerps(coins = PERP_COINS) {
  const [tickers, ...rates] = await Promise.all([
    getJson('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
    ...coins.map((c) =>
      getJson(`https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES&symbol=${c}USDT`).catch(() => null),
    ),
  ])
  const bySym = new Map((tickers?.data ?? []).map((t) => [t.symbol, t]))
  const out = {}
  coins.forEach((c, i) => {
    const t = bySym.get(`${c}USDT`)
    if (!t) return
    const fr = rates[i]?.data?.[0]
    const intervalH = num(fr?.fundingRateInterval) ?? 8
    const rate = num(fr?.fundingRate ?? t.fundingRate)
    const mark = num(t.markPrice)
    const index = num(t.indexPrice)
    out[c] = {
      venue: 'bitget',
      funding8h: rate == null ? null : (rate * 8) / intervalH,
      intervalH,
      nextFundingTime: num(fr?.nextUpdate),
      predicted8h: null,
      oiUsd: num(t.holdingAmount) != null && mark ? num(t.holdingAmount) * mark : null,
      mark,
      index,
      premium: premium(mark, index),
      note: 'USDT-margined',
    }
  })
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// ---------- Deribit ----------
// Perps: BTC-PERPETUAL / ETH-PERPETUAL (inverse, OI quoted in USD) plus the
// USDC linear perps (OI in coin). Dated BTC futures are used for annualised basis.
export async function fetchDeribitPerps(coins = PERP_COINS) {
  const base = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency'
  const [btc, eth, usdc] = await Promise.all([
    getJson(`${base}?currency=BTC&kind=future`).catch(() => null),
    getJson(`${base}?currency=ETH&kind=future`).catch(() => null),
    getJson(`${base}?currency=USDC&kind=future`).catch(() => null),
  ])
  if (!btc && !eth && !usdc) throw new Error('Network/CORS error')
  const all = [...(btc?.result ?? []), ...(eth?.result ?? []), ...(usdc?.result ?? [])]
  const byName = new Map(all.map((r) => [r.instrument_name, r]))
  const out = {}
  for (const c of coins) {
    const inv = byName.get(`${c}-PERPETUAL`)
    const lin = byName.get(`${c}_USDC-PERPETUAL`)
    if (!inv && !lin) continue
    const main = inv ?? lin
    const mark = num(main.mark_price)
    const index = num(main.estimated_delivery_price)
    const oiInv = inv ? num(inv.open_interest) : null // USD
    const oiLin = lin && num(lin.open_interest) != null ? num(lin.open_interest) * (num(lin.mark_price) ?? 0) : null
    // OI-weight the two funding prints if both exist.
    const fInv = inv ? num(inv.funding_8h) : null
    const fLin = lin ? num(lin.funding_8h) : null
    let funding8h = fInv ?? fLin
    if (fInv != null && fLin != null && (oiInv || oiLin)) {
      funding8h = (fInv * (oiInv ?? 0) + fLin * (oiLin ?? 0)) / ((oiInv ?? 0) + (oiLin ?? 0))
    }
    out[c] = {
      venue: 'deribit',
      funding8h,
      intervalH: 8,
      nextFundingTime: null,
      predicted8h: null,
      oiUsd: oiInv == null && oiLin == null ? null : (oiInv ?? 0) + (oiLin ?? 0),
      mark,
      index,
      premium: premium(mark, index),
      note: 'Continuous funding; rate = trailing 8h',
    }
  }

  // Annualised basis on dated BTC futures (closest to ~90 days, min 20 days).
  let basis = null
  const now = Date.now()
  for (const r of btc?.result ?? []) {
    const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})$/.exec(r.instrument_name)
    if (!m) continue
    const month = MONTHS.indexOf(m[2])
    if (month < 0) continue
    const expiry = Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8)
    const dte = (expiry - now) / 86_400_000
    const mark = num(r.mark_price)
    const index = num(r.estimated_delivery_price)
    if (!(dte >= 20) || !mark || !index) continue
    const ann = (mark / index - 1) * (365 / dte) * 100
    const cand = { instrument: r.instrument_name, dte, annualizedPct: ann, mark, index }
    if (!basis || Math.abs(dte - 90) < Math.abs(basis.dte - 90)) basis = cand
  }

  // v3: basis term structure — every dated BTC future ≥ 3 days out, front vs back.
  const curve = []
  for (const r of btc?.result ?? []) {
    const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})$/.exec(r.instrument_name)
    if (!m || MONTHS.indexOf(m[2]) < 0) continue
    const dte = (Date.UTC(2000 + Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1]), 8) - now) / 86_400_000
    const mark = num(r.mark_price)
    const index = num(r.estimated_delivery_price)
    if (!(dte >= 3) || !mark || !index) continue
    curve.push({ instrument: r.instrument_name, dte, annualizedPct: (mark / index - 1) * (365 / dte) * 100 })
  }
  curve.sort((a, b) => a.dte - b.dte)
  const basisTerm = curve.length >= 2 ? { front: curve[0], back: curve[curve.length - 1], curve } : null

  return { perps: out, basis, basisTerm }
}

// ---------- Binance USDⓈ-M (via our own /api/binance function) ----------
// Browsers in some regions get HTTP 451 from fapi.binance.com, so Binance is
// fetched server-side by api/binance.js (public market data only, fixed
// whitelist, CDN-cached 60 s). Optional: if the function fails, Binance is
// simply shown as "unavailable" and every other venue works as before.
// Returns { perps: { COIN: venueRow }, stats: { COIN: { oiChange24hPct, ... } } }.
export async function fetchBinancePerps(coins = PERP_COINS) {
  const json = await getJson('/api/binance')
  const perps = {}
  const stats = {}
  for (const c of coins) {
    const r = json?.coins?.[c]
    if (!r) continue
    perps[c] = {
      venue: 'binance',
      funding8h: num(r.funding8h),
      intervalH: num(r.intervalH) ?? 8,
      nextFundingTime: num(r.nextFundingTime),
      predicted8h: null, // Binance's live rate is already the estimate for the next settlement
      oiUsd: num(r.oiUsd),
      mark: num(r.mark),
      index: num(r.indexPrice ?? r.index),
      premium: num(r.premium),
      note: `USDⓈ-M ${r.symbol}; ${num(r.intervalH) === 8 ? '8h' : `${r.intervalH}h`} funding; OI × mark`,
    }
    stats[c] = {
      oiUsd: num(r.oiUsd),
      oiChangePct: num(r.oiChange24hPct),
      hours: num(r.oiHours),
      accountLsr: num(r.accountLsr),
      accountLsrThen: num(r.accountLsrThen),
      longAccountPct: num(r.longAccountPct),
      topPositionLsr: num(r.topPositionLsr),
      takerRatio: num(r.takerRatio),
      takerHours: num(r.takerHours),
    }
  }
  if (!Object.keys(perps).length) throw new Error(json?.error || 'No data')
  return { perps, stats, region: json?.region ?? null, fetchedAt: num(json?.fetchedAt) }
}

// ---------- dYdX v4 ----------
export async function fetchDydxPerps(coins = PERP_COINS) {
  const json = await getJson('https://indexer.dydx.trade/v4/perpetualMarkets')
  const out = {}
  for (const c of coins) {
    const m = json?.markets?.[`${c}-USD`]
    if (!m || m.status !== 'ACTIVE') continue
    const oracle = num(m.oraclePrice)
    const f1h = num(m.nextFundingRate)
    out[c] = {
      venue: 'dydx',
      funding8h: f1h == null ? null : f1h * 8,
      intervalH: 1,
      nextFundingTime: nextHour(),
      predicted8h: f1h == null ? null : f1h * 8,
      oiUsd: num(m.openInterest) != null && oracle ? num(m.openInterest) * oracle : null,
      mark: null,
      index: oracle,
      premium: null,
      note: 'Hourly funding (shown ×8); OI × oracle price',
    }
  }
  if (!Object.keys(out).length) throw new Error('No data')
  return out
}
