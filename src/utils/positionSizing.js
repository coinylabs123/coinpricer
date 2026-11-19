// Position-size suggestion for the Macro tab bias cards (Hyperliquid-first).
// Pure heuristics — not advice. The balance and settings live in localStorage
// only and are never sent to any API.
//
// Sized on the FULL Hyperliquid balance (treated as risk capital — no per-trade
// risk % haircut), but SUSTAINABLE: never maxed out, liquidation-safe, tail-capped.
//   side        = sign(score); FLAT when the call is Neutral (|score| < 0.2)
//   conviction  = call tier (Lean = 0.5, full Bullish/Bearish = 1.0)
//                 × confidence (High 1.0 · Medium 0.75 · Low 0.5); Neutral = 0
//   cap lev     = min(your max-leverage setting [default 3×], Hyperliquid maxLeverage)
//   conv. lev   = ⅔ × cap lev × conviction             (default: full call 2×, Lean ≤ 1×)
//   σ (1 sigma) = DVOL/100 × √(days / 365)              (= expected move; Overall uses the longest horizon)
//   maint. m    = 1 / (2 × HL maxLeverage) of notional
//   liq dist    ≈ 1 / lev − m                          (cross margin, whole balance, no other positions)
//   liq guard   : liq dist ≥ max(3, N) × σ   ⇒  lev ≤ 1 / (max(3, N)·σ + m)
//   tail cap    : lev × N·σ ≤ L                 ⇒  lev ≤ L / (N·σ)      (defaults N = 6, L = 30%)
//   lev         = min(conv. lev, cap lev, liq guard, tail cap);  notional = balance × lev
//   margin      = notional / cap lev   (initial margin if opened at the cap)
//   stop        = 1σ (info only); loss @ stop = notional × σ
//   funding     = HL hourly funding × 24 × days × notional (current rate held flat)
//
// Overall / net: each horizon's own (capped) signed BTC notional blended
//   ultra 30% · short 40% · medium 30%  →  net = Σ w × signed notional,
// then re-checked against the guards on the LONGEST horizon (30d σ).
import { carryFor } from './macroSignalsExtra.js'

export const SIZING_KEY = 'coinpricer.perpSizing'
export const SIZING_DEFAULTS = { balance: null, maxLev: 3, tailLossPct: 30, sigmaN: 6 }

// Ultra-short = "next 3–4 days"; Short-term = "days → ~2 weeks";
// Medium-term = "weeks → ~3 months" — its existing funding line uses 30d, so sizing does too.
export const SIZING_DAYS = { ust: 3.5, st: 14, mt: 30 }
export const BLEND = { ust: 0.3, st: 0.4, mt: 0.3 }
export const OVERALL_DAYS = Math.max(...Object.values(SIZING_DAYS))
export const FULL_CALL_SHARE = 2 / 3
export const LIQ_BUFFER_EM = 3
export const STRESS_SIGMAS = [4, 5, 6]

export const CONVICTION_TIER = { full: 1, lean: 0.5 }
export const CONFIDENCE_MULT = { High: 1, Medium: 0.75, Low: 0.5 }
export const FALLBACK_IV = 60 // only if DVOL is unavailable
export const FALLBACK_HL_MAX_LEV = { BTC: 40, ETH: 25 } // only if HL meta is unavailable

const num = (v, lo, hi) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null
}
export const parseAmount = (str) => num(str, 0, 1e12)
export const LIMITS = { maxLev: [1, 50], tailLossPct: [1, 100], sigmaN: [1, 10] }

export function sanitizeSizing(raw = {}) {
  return {
    balance: num(raw.balance, 0, 1e12),
    maxLev: num(raw.maxLev, ...LIMITS.maxLev) ?? SIZING_DEFAULTS.maxLev,
    tailLossPct: num(raw.tailLossPct, ...LIMITS.tailLossPct) ?? SIZING_DEFAULTS.tailLossPct,
    sigmaN: num(raw.sigmaN, ...LIMITS.sigmaN) ?? SIZING_DEFAULTS.sigmaN,
  }
}

export function loadSizing() {
  try {
    return sanitizeSizing(JSON.parse(localStorage.getItem(SIZING_KEY) || '{}'))
  } catch {
    return { ...SIZING_DEFAULTS }
  }
}

export function saveSizing(s) {
  try {
    localStorage.setItem(SIZING_KEY, JSON.stringify(sanitizeSizing(s)))
  } catch {
    /* storage disabled — keep in memory only */
  }
}

export function convictionFor(bias) {
  const s = bias?.score
  if (s == null || Math.abs(s) < 0.2) return { side: 'FLAT', sign: 0, tier: 0, confMult: 0, conviction: 0 }
  const tier = Math.abs(s) >= 0.5 ? CONVICTION_TIER.full : CONVICTION_TIER.lean
  const confMult = CONFIDENCE_MULT[bias.confidence?.label] ?? 0.5
  return { side: s > 0 ? 'LONG' : 'SHORT', sign: Math.sign(s), tier, confMult, conviction: tier * confMult }
}

// Per-coin market context: HL max leverage, HL hourly funding, DVOL.
function coinCtx(coin, { sources, perpRows }) {
  const hl = sources.hyperliquid?.status === 'success' ? sources.hyperliquid.data?.[coin] : null
  const dv = sources.dvol?.status === 'success' ? sources.dvol.data?.[coin] : null
  let f1hPct = hl?.funding1h != null ? hl.funding1h * 100 : null
  let fundingSrc = 'on Hyperliquid'
  if (f1hPct == null) {
    const c = carryFor(perpRows, 1).find((x) => x.coin === coin)
    f1hPct = c ? c.f / 8 : null
    fundingSrc = 'all-venue average (Hyperliquid unavailable)'
  }
  return {
    hlMax: hl?.maxLeverage ?? FALLBACK_HL_MAX_LEV[coin],
    hlMaxFallback: hl?.maxLeverage == null,
    iv: dv?.now ?? FALLBACK_IV,
    ivFallback: dv?.now == null,
    f1hPct,
    fundingSrc,
    mark: hl?.mark ?? null,
  }
}

// Apply every cap to a desired signed notional and describe the result.
function describe({ coin, desired, days, settings, cx, extra }) {
  const { balance, maxLev, tailLossPct, sigmaN } = settings
  const capLev = Math.min(maxLev, cx.hlMax)
  const sigma = (cx.iv / 100) * Math.sqrt(days / 365) // fraction
  const mmr = 1 / (2 * cx.hlMax)
  const guardLev = 1 / (Math.max(LIQ_BUFFER_EM, sigmaN) * sigma + mmr)
  const tailLev = tailLossPct / 100 / (sigmaN * sigma)
  const wantLev = balance ? Math.abs(desired) / balance : 0
  const caps = [
    ['conviction', wantLev],
    ['max leverage', capLev],
    ['liquidation guard', guardLev],
    [`${sigmaN}σ tail cap`, tailLev],
  ]
  const [binding, lev] = caps.reduce((a, c) => (c[1] < a[1] ? c : a))
  const notional = balance * lev
  const side = desired === 0 || notional < 1e-9 ? 'FLAT' : desired > 0 ? 'LONG' : 'SHORT'
  const signed = side === 'FLAT' ? 0 : Math.sign(desired) * notional
  const liq = lev > 0 ? Math.max(0, 1 / lev - mmr) : null // fraction
  const fundingPct = side === 'FLAT' || cx.f1hPct == null ? null : (side === 'LONG' ? 1 : -1) * cx.f1hPct * 24 * days
  const ks = [...new Set([...STRESS_SIGMAS, sigmaN])].sort((a, b) => a - b)
  const stress = ks.map((k) => {
    const move = k * sigma
    return { k, movePct: move * 100, lossUsd: notional * move, lossPctBal: lev * move * 100, liquidated: liq != null && move >= liq }
  })
  return {
    coin,
    side,
    days,
    signed,
    notional,
    lev,
    wantLev,
    capLev,
    guardLev,
    tailLev,
    binding: side === 'FLAT' ? null : binding,
    margin: notional / capLev,
    sigmaPct: sigma * 100,
    stopPct: sigma * 100,
    lossAtStop: notional * sigma,
    liqPct: liq == null ? null : liq * 100,
    liqInSigma: liq == null ? null : liq / sigma,
    mmrPct: mmr * 100,
    fundingPct,
    fundingUsd: fundingPct == null ? null : notional * (fundingPct / 100),
    stress,
    ...cx,
    ...extra,
  }
}

export const COINS = ['BTC', 'ETH']

const desiredFor = (c, settings, cx) => c.sign * settings.balance * FULL_CALL_SHARE * Math.min(settings.maxLev, cx.hlMax) * c.conviction

// One horizon card → [BTC, ETH] (each is the whole suggestion on that coin, not both at once).
export function sizeFor({ bias, horizon, settings, sources, perpRows }) {
  if (!settings.balance || bias?.score == null) return null
  const c = convictionFor(bias)
  return COINS.map((coin) => {
    const cx = coinCtx(coin, { sources, perpRows })
    return describe({ coin, desired: desiredFor(c, settings, cx), days: SIZING_DAYS[horizon], settings, cx, extra: c })
  })
}

// Overall / net card: blend each horizon's own (capped) signed notional.
export function sizeOverall({ biases, settings, sources, perpRows }) {
  if (!settings.balance) return null
  const keys = Object.keys(BLEND)
  if (keys.some((k) => biases[k]?.score == null)) return null
  const parts = keys.map((k) => ({ key: k, w: BLEND[k], score: biases[k].score, ...convictionFor(biases[k]) }))
  const score = parts.reduce((a, p) => a + p.w * p.score, 0)
  const disagree = new Set(parts.filter((p) => p.sign).map((p) => p.sign)).size > 1
  const flats = parts.filter((p) => !p.sign).length
  const coins = COINS.map((coin) => {
    const cx = coinCtx(coin, { sources, perpRows })
    const contribs = parts.map((p) => {
      const own = describe({ coin, desired: desiredFor(p, settings, cx), days: SIZING_DAYS[p.key], settings, cx })
      return { ...p, own, signed: p.w * own.signed }
    })
    const desired = contribs.reduce((a, p) => a + p.signed, 0)
    const gross = contribs.reduce((a, p) => a + Math.abs(p.signed), 0)
    return describe({ coin, desired, days: OVERALL_DAYS, settings, cx, extra: { contribs, gross, blendedNotional: Math.abs(desired) } })
  })
  return { score, parts, disagree, flats, coins }
}
