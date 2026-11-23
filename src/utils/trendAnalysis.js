// Trend page model: for each horizon, the probability that the current trend
// CONTINUES, REVERSES, or the market RANGES. Heuristic, not backtested.
//
// Inputs are the same free snapshots the Macro page already loads (no extra
// requests, no price history) plus the CoinGecko top-100 snapshot, which already
// carries 1h/24h/7d/14d/30d/200d/1y % changes.
//
//   1. Direction: BTC (70%) + the median top-100 coin (30%) over the horizon's
//      windows, each move scaled by the Deribit-DVOL-implied σ for that window
//      (σ = DVOL/100 · √(days/365)).
//   2. Evidence: every indicator gives a 0..1 reading for each of the three
//      outcomes, with a per-horizon weight. Missing data drops out (and lowers
//      coverage).
//   3. Class score = weighted average of its evidence (0..1) → softmax → shrunk
//      toward 1/3 by data coverage → floored at 10% so it never shows certainty.
import { FALLBACK_IV } from './positionSizing.js'
import { oiChange24hFor } from './perpsAnalysis.js'

export const TREND_FLOOR = 0.1
export const TREND_BETA = 3

export const TREND_HORIZONS = [
  { key: 'ust', title: 'Ultra-short', span: 'next 3–4 days', windows: [{ k: '24h', days: 1, w: 0.4 }, { k: '7d', days: 7, w: 0.6 }] },
  { key: 'st', title: 'Short-term', span: 'days → ~2 weeks', windows: [{ k: '7d', days: 7, w: 0.5 }, { k: '14d', days: 14, w: 0.5 }] },
  { key: 'mt', title: 'Medium-term', span: 'weeks → ~3 months', windows: [{ k: '30d', days: 30, w: 0.4 }, { k: '200d', days: 200, w: 0.4 }, { k: '1y', days: 365, w: 0.2 }] },
]

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const ok = (s) => s?.status === 'success' && s.data
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const spct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)

const FIELD = {
  '1h': 'price_change_percentage_1h_in_currency',
  '24h': 'price_change_percentage_24h_in_currency',
  '7d': 'price_change_percentage_7d_in_currency',
  '14d': 'price_change_percentage_14d_in_currency',
  '30d': 'price_change_percentage_30d_in_currency',
  '200d': 'price_change_percentage_200d_in_currency',
  '1y': 'price_change_percentage_1y_in_currency',
}
const changeOf = (coin, k) => {
  const v = coin?.[FIELD[k]] ?? (k === '24h' ? coin?.price_change_percentage_24h : null)
  return Number.isFinite(Number(v)) && v != null ? Number(v) : null
}

// Stablecoins and wrapped / staked copies would drag the "market" median to zero.
const NON_MARKET = new Set([
  'tether', 'usd-coin', 'usds', 'dai', 'ethena-usde', 'paypal-usd', 'first-digital-usd', 'usd1-wlfi', 'usdtb',
  'staked-ether', 'wrapped-steth', 'wrapped-bitcoin', 'weth', 'wrapped-eeth', 'coinbase-wrapped-btc', 'wrapped-beacon-eth',
  'binance-bridged-usdt-bnb-smart-chain', 'usdt0', 'bitcoin',
])
const looksStable = (c) => {
  const p = Number(c.current_price)
  return p > 0.97 && p < 1.03 && Math.abs(changeOf(c, '7d') ?? 0) < 1 && Math.abs(changeOf(c, '30d') ?? 0) < 1.5
}

// ---------- shared inputs (computed once per render, used by all horizons) ----------
export function trendInputs({ sources, perpRows, coins }) {
  const btc = coins?.find((c) => c.id === 'bitcoin') ?? null
  const alts = (coins ?? []).filter((c) => !NON_MARKET.has(c.id) && !looksStable(c)).slice(0, 60)
  const dv = ok(sources.dvol) ? sources.dvol.data.BTC : null
  const rows = (perpRows ?? []).filter((r) => r.coin === 'BTC' || r.coin === 'ETH')
  const fRows = rows.filter((r) => r.fundingPct != null)
  const fw = fRows.reduce((a, r) => a + (r.oiUsd || 1), 0)
  const funding = fRows.length ? fRows.reduce((a, r) => a + r.fundingPct * (r.oiUsd || 1), 0) / fw : null
  const oiRows = rows.filter((r) => r.oiUsd != null && r.mcap)
  const oiPct = oiRows.length ? (oiRows.reduce((a, r) => a + r.oiUsd, 0) / oiRows.reduce((a, r) => a + r.mcap, 0)) * 100 : null
  const oiParts = ['BTC', 'ETH'].map((c) => oiChange24hFor(c, sources)).filter((x) => x.pct != null)
  const oiW = oiParts.reduce((a, x) => a + (x.oiUsd || 1), 0)
  const oiChg = oiParts.length ? oiParts.reduce((a, x) => a + x.pct * (x.oiUsd || 1), 0) / oiW : null
  const taker = [
    sources.binance?.data?.stats?.BTC?.takerRatio,
    sources.gateStats?.data?.BTC?.takerRatio,
    sources.bitgetFlow?.data?.BTC?.takerRatio,
  ].filter((x) => x != null && x > 0)
  const lsr = [
    sources.binance?.data?.stats?.BTC?.accountLsr,
    sources.bitgetFlow?.data?.BTC?.accountLsr,
  ].filter((x) => x != null && x > 0)
  const opt = ok(sources.deribitOptions) ? sources.deribitOptions.data : null
  return {
    btc,
    alts,
    dvol: dv?.now ?? null,
    dvolChg: dv?.change24hPct ?? null,
    funding,
    oiPct,
    oiChg,
    taker: taker.length ? avg(taker) : null,
    lsr: lsr.length ? Math.exp(avg(lsr.map(Math.log))) : null,
    basis: ok(sources.deribit) ? sources.deribit.data?.basis?.annualizedPct ?? null : null,
    skew: opt?.skew?.skew ?? null,
    pcr: opt?.frontPcr?.pcr ?? opt?.pcr ?? null,
    fng: ok(sources.fng) ? sources.fng.data[0]?.value ?? null : null,
    stable7d: ok(sources.llama) ? sources.llama.data.change7d : null,
    stable30d: ok(sources.llama) ? sources.llama.data.change30d : null,
    tvl7d: ok(sources.tvl) ? sources.tvl.data.change7d : null,
    tvl30d: ok(sources.tvl) ? sources.tvl.data.change30d : null,
  }
}

// ---------- direction ----------
function directionFor(h, inp) {
  const iv = inp.dvol ?? FALLBACK_IV
  const sigma = (days) => (iv / 100) * Math.sqrt(days / 365) * 100 // % move
  const parts = h.windows.map((w) => {
    const btc = changeOf(inp.btc, w.k)
    const mk = median(inp.alts.map((c) => changeOf(c, w.k)).filter((x) => x != null))
    const breadthSet = inp.alts.map((c) => changeOf(c, w.k)).filter((x) => x != null)
    const s = sigma(w.days)
    return {
      ...w,
      btc,
      mk,
      zBtc: btc == null ? null : btc / s,
      zMk: mk == null ? null : mk / (s * 1.5), // alts carry roughly 1.5× BTC's vol
      breadth: breadthSet.length >= 10 ? breadthSet.filter((x) => x > 0).length / breadthSet.length : null,
    }
  })
  const have = parts.filter((p) => p.zBtc != null || p.zMk != null)
  if (!have.length) return null
  const wsum = have.reduce((a, p) => a + p.w, 0)
  const blend = (p) => {
    const a = p.zBtc, b = p.zMk
    if (a != null && b != null) return 0.7 * a + 0.3 * b
    return a ?? b
  }
  const z = have.reduce((acc, p) => acc + blend(p) * p.w, 0) / wsum // signed σ-multiples
  const score = have.reduce((acc, p) => acc + Math.tanh(blend(p) / 1.5) * p.w, 0) / wsum // -1..1
  const u = score >= 0 ? 1 : -1
  const aligned = have.reduce((acc, p) => acc + (Math.sign(blend(p)) === u ? p.w : 0), 0) / wsum
  const first = blend(have[0])
  const breadthW = have.filter((p) => p.breadth != null)
  const breadth = breadthW.length ? breadthW.reduce((a, p) => a + p.breadth * p.w, 0) / breadthW.reduce((a, p) => a + p.w, 0) : null
  const strength = Math.abs(score)
  return {
    u,
    z,
    absZ: Math.abs(z),
    score,
    aligned,
    opposing: clamp(-u * Math.tanh(first / 1.5)),
    breadth,
    strength,
    strengthLabel: strength < 0.15 ? 'no clear trend' : strength < 0.4 ? 'weak' : strength < 0.7 ? 'moderate' : 'strong',
    windows: have.map((p) => ({ k: p.k, btc: p.btc, mk: p.mk })),
    ivFallback: inp.dvol == null,
  }
}

// ---------- evidence ----------
// Each item: id, cls (C continuation · R reversal · G ranging), label,
// w = weight per horizon [ust, st, mt], and a function (inp, dir) → { v: 0..1, text } | null.
const A = (u, x) => u * x // sign-align a reading with the trend

const EVIDENCE = [
  // ----- continuation -----
  { id: 'mom', cls: 'C', label: 'Momentum aligned', w: [30, 30, 30], f: (i, d) => {
    const bump = d.absZ > 2.5 ? Math.max(0.4, 1 - (d.absZ - 2.5) / 3) : 1 // very stretched moves lose credit
    return { v: d.aligned * clamp(d.absZ / 1.2) * bump, text: `${Math.round(d.aligned * 100)}% of windows agree, ${d.absZ.toFixed(1)}σ move` }
  } },
  { id: 'breadthC', cls: 'C', label: 'Broad participation', w: [12, 12, 10], f: (i, d) => d.breadth == null ? null : { v: clamp(A(d.u, d.breadth - 0.5) / 0.25), text: `${Math.round(d.breadth * 100)}% of top coins up` } },
  { id: 'oiPrice', cls: 'C', label: 'OI building with trend', w: [10, 6, 0], f: (i) => {
    if (i.oiChg == null) return null
    const x = i.oiChg
    const v = x <= 0 ? 0 : x <= 8 ? clamp(x / 2) : clamp(1 - (x - 8) / 8) * 1 // 2–8% = healthy, >8% = stretched
    return { v, text: `OI ${spct(x)} 24h` }
  } },
  { id: 'fundOk', cls: 'C', label: 'Funding healthy', w: [10, 10, 5], f: (i, d) => {
    if (i.funding == null) return null
    const f = i.funding
    // up: positive but below crowded (0.01–0.03); down: shorts paying but not crowded (-0.02–0.005)
    const v = d.u > 0 ? (f < 0.005 ? clamp(f / 0.005) * 0.5 : f <= 0.03 ? 1 : clamp(1 - (f - 0.03) / 0.03)) : (f > 0.01 ? clamp(1 - (f - 0.01) / 0.02) * 0.5 : f >= -0.02 ? 1 : clamp(1 - (-0.02 - f) / 0.02))
    return { v, text: `funding ${spct(f, 4)}/8h` }
  } },
  { id: 'taker', cls: 'C', label: 'Taker flow aligned', w: [10, 6, 0], f: (i, d) => i.taker == null ? null : { v: clamp(A(d.u, Math.log(i.taker)) / 0.1), text: `taker buy/sell ${i.taker.toFixed(2)}` } },
  { id: 'basis', cls: 'C', label: 'Futures basis', w: [5, 10, 10], f: (i, d) => {
    if (i.basis == null) return null
    const b = i.basis
    // healthy up: 4–14% APR; healthy down: flat/negative-to-low (≤ 6%)
    const v = d.u > 0 ? (b < 4 ? clamp(b / 4) : b <= 14 ? 1 : clamp(1 - (b - 14) / 8)) : b <= 6 ? 1 : clamp(1 - (b - 6) / 10)
    return { v, text: `basis ${spct(b)} APR` }
  } },
  { id: 'fngC', cls: 'C', label: 'Sentiment not extreme', w: [8, 8, 8], f: (i, d) => {
    if (i.fng == null) return null
    const dev = A(d.u, i.fng - 50) // + when sentiment leans with the trend
    return { v: clamp(1 - Math.abs(i.fng - 50) / 35) * (dev > -10 ? 1 : 0.4), text: `F&G ${i.fng}` }
  } },
  { id: 'stableC', cls: 'C', label: 'Stablecoin supply aligned', w: [5, 10, 12], f: (i, d, h) => {
    const x = h.key === 'ust' ? i.stable7d : h.key === 'st' ? avg([i.stable7d, i.stable30d].filter((y) => y != null)) : i.stable30d
    if (x == null) return null
    const scale = h.key === 'mt' ? 1.5 : h.key === 'st' ? 0.8 : 0.4
    return { v: clamp(A(d.u, x) / scale), text: `stablecoins ${spct(x)}` }
  } },
  { id: 'tvlC', cls: 'C', label: 'DeFi TVL aligned', w: [0, 5, 8], f: (i, d, h) => {
    const x = h.key === 'st' ? i.tvl7d : i.tvl30d
    if (x == null) return null
    return { v: clamp(A(d.u, x) / (h.key === 'st' ? 6 : 12)), text: `TVL ${spct(x)}` }
  } },

  // ----- reversal -----
  { id: 'opp', cls: 'R', label: 'Recent move against trend', w: [22, 20, 15], f: (i, d) => ({ v: d.opposing, text: `${d.windows[0].k} ${spct(d.windows[0].btc)} vs trend` }) },
  { id: 'over', cls: 'R', label: 'Move overextended', w: [15, 15, 15], f: (i, d) => ({ v: clamp((d.absZ - 2) / 2), text: `${d.absZ.toFixed(1)}σ move` }) },
  { id: 'fngR', cls: 'R', label: 'Sentiment extreme', w: [12, 12, 10], f: (i, d) => {
    if (i.fng == null) return null
    const dev = A(d.u, i.fng - 50)
    return { v: dev > 0 ? clamp((dev - 25) / 20) : 0, text: `F&G ${i.fng}` }
  } },
  { id: 'crowd', cls: 'R', label: 'Crowded funding', w: [14, 14, 8], f: (i, d) => {
    if (i.funding == null) return null
    const f = i.funding
    return { v: d.u > 0 ? clamp((f - 0.015) / 0.03) : clamp((-f - 0.005) / 0.025), text: `funding ${spct(f, 4)}/8h` }
  } },
  { id: 'oiStretch', cls: 'R', label: 'OI stretched vs mcap', w: [8, 8, 6], f: (i) => i.oiPct == null ? null : { v: clamp((i.oiPct - 1) / 2), text: `OI ${i.oiPct.toFixed(2)}% of mcap` } },
  { id: 'lsr', cls: 'R', label: 'Crowded accounts', w: [10, 8, 0], f: (i, d) => i.lsr == null ? null : { v: clamp((A(d.u, Math.log(i.lsr)) - 0.2) / 0.5), text: `L/S accounts ${i.lsr.toFixed(2)}` } },
  { id: 'opt', cls: 'R', label: 'Options extreme', w: [10, 10, 8], f: (i, d) => {
    const parts = []
    // up-trend: euphoria = low/negative skew, call-heavy; down-trend: fear = steep put skew, put-heavy
    if (i.skew != null) parts.push({ v: d.u > 0 ? clamp((2 - i.skew) / 6) : clamp((i.skew - 6) / 8), t: `skew ${i.skew.toFixed(1)}` })
    if (i.pcr != null) parts.push({ v: d.u > 0 ? clamp((0.45 - i.pcr) / 0.2) : clamp((i.pcr - 0.8) / 0.4), t: `P/C ${i.pcr.toFixed(2)}` })
    if (!parts.length) return null
    return { v: avg(parts.map((p) => p.v)), text: parts.map((p) => p.t).join(', ') }
  } },
  { id: 'dvolSpike', cls: 'R', label: 'Implied vol jumping', w: [10, 6, 4], f: (i) => i.dvolChg == null ? null : { v: clamp((i.dvolChg - 3) / 12), text: `DVOL ${spct(i.dvolChg)} 24h` } },
  { id: 'oiFlush', cls: 'R', label: 'OI draining', w: [10, 8, 0], f: (i) => i.oiChg == null ? null : { v: clamp((-i.oiChg - 1) / 6), text: `OI ${spct(i.oiChg)} 24h` } },
  { id: 'breadthR', cls: 'R', label: 'Narrow participation', w: [10, 10, 10], f: (i, d) => d.breadth == null ? null : { v: clamp(-A(d.u, d.breadth - 0.5) / 0.25), text: `${Math.round(d.breadth * 100)}% of top coins up` } },
  { id: 'stableR', cls: 'R', label: 'Stablecoin supply opposing', w: [5, 10, 12], f: (i, d, h) => {
    const x = h.key === 'ust' ? i.stable7d : h.key === 'st' ? avg([i.stable7d, i.stable30d].filter((y) => y != null)) : i.stable30d
    if (x == null) return null
    const scale = h.key === 'mt' ? 1.5 : h.key === 'st' ? 0.8 : 0.4
    return { v: clamp(-A(d.u, x) / scale), text: `stablecoins ${spct(x)}` }
  } },
  { id: 'tvlR', cls: 'R', label: 'DeFi TVL opposing', w: [0, 5, 8], f: (i, d, h) => {
    const x = h.key === 'st' ? i.tvl7d : i.tvl30d
    if (x == null) return null
    return { v: clamp(-A(d.u, x) / (h.key === 'st' ? 6 : 12)), text: `TVL ${spct(x)}` }
  } },

  // ----- ranging -----
  { id: 'quiet', cls: 'G', label: 'Move small vs implied vol', w: [30, 30, 25], f: (i, d) => ({ v: clamp(1 - d.absZ / 1.5), text: `${d.absZ.toFixed(1)}σ move` }) },
  { id: 'mixed', cls: 'G', label: 'Windows disagree', w: [15, 15, 15], f: (i, d) => ({ v: clamp((1 - d.aligned) * 2), text: `${Math.round(d.aligned * 100)}% of windows agree` }) },
  { id: 'flatF', cls: 'G', label: 'Funding at baseline', w: [10, 8, 6], f: (i) => i.funding == null ? null : { v: clamp(1 - Math.abs(i.funding - 0.01) / 0.02), text: `funding ${spct(i.funding, 4)}/8h` } },
  { id: 'flatOi', cls: 'G', label: 'OI flat', w: [10, 8, 0], f: (i) => i.oiChg == null ? null : { v: clamp(1 - (Math.abs(i.oiChg) - 1) / 5), text: `OI ${spct(i.oiChg)} 24h` } },
  { id: 'breadthG', cls: 'G', label: 'Breadth split', w: [8, 8, 8], f: (i, d) => d.breadth == null ? null : { v: clamp(1 - Math.abs(d.breadth - 0.5) / 0.15), text: `${Math.round(d.breadth * 100)}% of top coins up` } },
  { id: 'lowVol', cls: 'G', label: 'Implied vol low', w: [10, 10, 10], f: (i) => i.dvol == null ? null : { v: clamp((55 - i.dvol) / 25), text: `DVOL ${i.dvol.toFixed(0)}` } },
  { id: 'fngG', cls: 'G', label: 'Sentiment neutral', w: [10, 10, 10], f: (i) => i.fng == null ? null : { v: clamp(1 - (Math.abs(i.fng - 50) - 10) / 15), text: `F&G ${i.fng}` } },
]

const CLS = { C: 'continuation', R: 'reversal', G: 'ranging' }
const IDX = { ust: 0, st: 1, mt: 2 }

function normalise(scores, coverage) {
  const keys = ['C', 'R', 'G']
  const ex = keys.map((k) => Math.exp(TREND_BETA * scores[k]))
  const sum = ex.reduce((a, b) => a + b, 0)
  let p = ex.map((e) => e / sum)
  p = p.map((x) => coverage * x + (1 - coverage) / 3) // thin data → toward 1/3
  p = p.map((x) => TREND_FLOOR + (1 - 3 * TREND_FLOOR) * x) // never below 10%
  return Object.fromEntries(keys.map((k, i) => [CLS[k], p[i]]))
}

export function evaluateTrend({ sources, perpRows, coins }) {
  const inp = trendInputs({ sources, perpRows, coins })
  return TREND_HORIZONS.map((h) => {
    const dir = directionFor(h, inp)
    if (!dir) return { ...h, status: coins?.length ? 'error' : 'loading' }
    const wi = IDX[h.key]
    const items = EVIDENCE.map((e) => {
      const weight = e.w[wi]
      if (!weight) return null
      const r = e.f(inp, dir, h)
      return { id: e.id, cls: e.cls, label: e.label, weight, v: r?.v ?? null, text: r?.text ?? null }
    }).filter(Boolean)
    const scores = {}
    let haveW = 0
    let totW = 0
    for (const k of ['C', 'R', 'G']) {
      const its = items.filter((x) => x.cls === k)
      const t = its.reduce((a, x) => a + x.weight, 0)
      const av = its.filter((x) => x.v != null)
      const w = av.reduce((a, x) => a + x.weight, 0)
      scores[k] = w ? av.reduce((a, x) => a + x.weight * x.v, 0) / w : 0
      haveW += w
      totW += t
    }
    const coverage = haveW / totW
    const probs = normalise(scores, coverage)
    const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1])
    const [top, second] = ranked
    const margin = top[1] - second[1]
    const confidence = coverage >= 0.8 && margin >= 0.15 ? 'High' : coverage >= 0.6 && margin >= 0.07 ? 'Medium' : 'Low'
    const topCls = Object.keys(CLS).find((k) => CLS[k] === top[0])
    const drivers = items
      .filter((x) => x.cls === topCls && x.v != null && x.v >= 0.3)
      .sort((a, b) => b.weight * b.v - a.weight * a.v)
      .slice(0, 3)
    return {
      ...h,
      status: 'success',
      dir,
      scores,
      probs,
      top: top[0],
      margin,
      coverage,
      confidence,
      drivers,
      items,
    }
  })
}
