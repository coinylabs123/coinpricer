// Opportunistic split of the Overall net position across Hyperliquid tickers.
// Heuristics, not advice. No price history — only current snapshots.
//
// 1. Universe   = coins in the perps table that trade on Hyperliquid with
//                 HL open interest ≥ $25M and HL 24h volume ≥ $10M.
// 2. σ per coin (fraction, over the Overall 7-day hold):
//      BTC / ETH  = their own Deribit DVOL × √(days/365)
//      alts       = BTC DVOL × multiplier × √(days/365), multiplier = the HIGHER of
//                   market-cap tier (≥ $50B ×1.5 · $10–50B ×2 · < $10B ×2.5) and
//                   HL max-leverage tier (≥ 20× → ×1.5 · 10–19× → ×2 · < 10× → ×2.5)
// 3. Reward (in the net's direction d = +1 long / −1 short), from the perps table:
//      L = 0.4·read + 0.3·funding + 0.15·premium + 0.15·OI-change
//        read:    Squeeze long +1 · Contrarian long +0.6 · Reset / No edge 0 ·
//                 Don't chase −0.4 · Fade longs −1
//        funding: the existing funding score (paid-to-hold side scores well)
//        premium: −premium / 0.1%, clamped ±1 (discount favours longs)
//        OI chg:  ±(24h OI change / 10%), positive when OI builds against the paying side
//      reward = max(0, 0.25 + d·L); 0 if the coin's trade read opposes the net.
//      (0.25 = base "beta" so a no-edge coin can still carry the macro net.)
// 4. Risk/reward = reward ÷ σ. Take the top 5 with reward > 0.
// 5. Weights ∝ (risk/reward) ÷ σ (inverse-vol weighted), no coin above max(50%, 1/n).
// 6. Combined caps on the whole basket (cross margin, all coins moving against you
//    together, which is the conservative case):
//      tail:  Σ |nᵢ|·N·σᵢ ≤ L·balance                     (defaults N = 6, L = 30%)
//      liq:   Σ |nᵢ|·(max(3,N)·σᵢ + mmrᵢ) ≤ balance,   mmrᵢ = 1/(2·HL maxLevᵢ)
//      lev:   Σ |nᵢ| ≤ min(your max lev, …)·balance;  nᵢ ≤ HL maxLevᵢ·balance
//    The basket is scaled down by the tightest one.
import { clamp } from './macroSignals.js'
import { fundingScore } from './macroSignalsExtra.js'
import { FALLBACK_IV, OVERALL_DAYS, STRESS_SIGMAS, LIQ_BUFFER_EM } from './positionSizing.js'

export const LIQ_FLOOR = { oiUsd: 25e6, volUsd: 10e6 }
export const MAX_PICKS = 5
export const MAX_WEIGHT = 0.5
export const BASE_REWARD = 0.25

const READ_SCORE = { 'squeeze-long': 1, 'contra-long': 0.6, reset: 0, 'no-edge': 0, 'avoid-long': -0.4, 'fade-long': -1 }
const LONG_READS = new Set(['squeeze-long', 'contra-long'])
const SHORT_READS = new Set(['fade-long'])

function volMultiplier(mcap, hlMax) {
  const capM = mcap == null ? 2.5 : mcap >= 50e9 ? 1.5 : mcap >= 10e9 ? 2 : 2.5
  const levM = hlMax == null ? 2.5 : hlMax >= 20 ? 1.5 : hlMax >= 10 ? 2 : 2.5
  return Math.max(capM, levM)
}

function whyFor(row, d, f1h) {
  const k = row.tradeRead?.key
  const a =
    k === 'squeeze-long' ? 'shorts crowded' :
    k === 'contra-long' ? 'shorts paying' :
    k === 'fade-long' ? 'longs crowded' :
    k === 'avoid-long' ? 'longs paying' :
    k === 'reset' ? 'leverage flushed' : 'no crowding'
  const earns = f1h != null && d * f1h < 0
  const b = f1h == null ? null : earns ? 'paid funding' : Math.abs(f1h) < 0.0005 ? 'cheap funding' : 'pays funding'
  return [a, b].filter(Boolean).join(', ')
}

const empty = (extra) => ({ side: 'FLAT', picks: [], cands: [], desired: 0, total: 0, lev: 0, scale: 0, binding: 'flat net',
  shrunk: false, stress: [], liqInSigma: null, lossAtStop: 0, fundingUsd: 0, margin: 0, ...extra })

export function allocateNet({ net, perpRows, sources, settings }) {
  if (!net || !settings.balance) return null
  if (net.side === 'FLAT') return empty()
  const d = net.side === 'LONG' ? 1 : -1
  const hl = sources.hyperliquid?.status === 'success' ? sources.hyperliquid.data : {}
  const dvol = sources.dvol?.status === 'success' ? sources.dvol.data : {}
  const btcIv = dvol?.BTC?.now ?? FALLBACK_IV
  const t = Math.sqrt(OVERALL_DAYS / 365)
  const { balance, maxLev, tailLossPct, sigmaN } = settings

  const cands = perpRows
    .map((r) => {
      const h = hl?.[r.coin]
      if (!h) return null
      const liquid = (h.oiUsd ?? 0) >= LIQ_FLOOR.oiUsd && (h.volUsd ?? 0) >= LIQ_FLOOR.volUsd
      const ownIv = dvol?.[r.coin]?.now
      const mult = ownIv != null ? 1 : volMultiplier(r.mcap, h.maxLeverage)
      const iv = ownIv ?? btcIv * mult
      const sigma = (iv / 100) * t
      const f = r.fundingPct
      const readK = r.tradeRead?.key
      const readS = READ_SCORE[readK] ?? 0
      const fundS = f == null ? 0 : fundingScore(f)
      const premS = r.premiumPct == null ? 0 : clamp(-r.premiumPct / 0.1)
      const oiS = r.oiChange24hPct == null || f == null ? 0 : clamp(r.oiChange24hPct / 10) * (f < 0.01 ? 1 : -1)
      const L = 0.4 * readS + 0.3 * fundS + 0.15 * premS + 0.15 * oiS
      const opposes = d > 0 ? SHORT_READS.has(readK) : LONG_READS.has(readK)
      const reward = opposes ? 0 : Math.max(0, BASE_REWARD + d * L)
      return {
        coin: r.coin,
        liquid,
        hlMax: h.maxLeverage ?? 10,
        mmr: 1 / (2 * (h.maxLeverage ?? 10)),
        f1h: h.funding1h,
        oiUsd: h.oiUsd,
        volUsd: h.volUsd,
        iv,
        ivSrc: ownIv != null ? 'DVOL' : `BTC DVOL ×${mult}`,
        sigma,
        L,
        reward,
        opposes,
        rr: sigma ? reward / sigma : 0,
        read: r.tradeRead?.label ?? '—',
        why: whyFor(r, d, h.funding1h),
      }
    })
    .filter(Boolean)

  const eligible = cands.filter((c) => c.liquid && c.reward > 0).sort((a, b) => b.rr - a.rr)
  const picks = eligible.slice(0, MAX_PICKS)
  if (!picks.length) return empty({ cands, binding: 'no eligible coins', desired: net.blendedNotional ?? net.notional })

  // inverse-vol weighted risk/reward, capped per coin (water-filling)
  const cap = Math.max(MAX_WEIGHT, 1 / picks.length)
  let raw = picks.map((p) => p.rr / p.sigma)
  let w = raw.map(() => 0)
  let free = picks.map((_, i) => i)
  let left = 1
  for (let iter = 0; iter < 10 && free.length; iter++) {
    const sum = free.reduce((a, i) => a + raw[i], 0)
    const over = free.filter((i) => (raw[i] / sum) * left > cap)
    if (!over.length) {
      free.forEach((i) => (w[i] = (raw[i] / sum) * left))
      break
    }
    over.forEach((i) => (w[i] = cap))
    left -= cap * over.length
    free = free.filter((i) => !over.includes(i))
  }

  const desired = net.blendedNotional ?? net.notional // conviction-blended size before caps
  const n0 = picks.map((_, i) => desired * w[i])
  const capLev = maxLev
  const tailUse = n0.reduce((a, n, i) => a + n * sigmaN * picks[i].sigma, 0)
  const liqUse = n0.reduce((a, n, i) => a + n * (Math.max(LIQ_BUFFER_EM, sigmaN) * picks[i].sigma + picks[i].mmr), 0)
  const scales = [
    ['conviction', 1],
    [`${sigmaN}σ tail cap (basket)`, tailUse ? ((tailLossPct / 100) * balance) / tailUse : Infinity],
    ['liquidation guard (basket)', liqUse ? balance / liqUse : Infinity],
    ['max leverage', desired ? (capLev * balance) / desired : Infinity],
    ...picks.map((p, i) => [`${p.coin} HL max leverage`, n0[i] ? (p.hlMax * balance) / n0[i] : Infinity]),
  ]
  const [binding, scale] = scales.reduce((a, s) => (s[1] < a[1] ? s : a))
  const rows = picks.map((p, i) => {
    const n = n0[i] * scale
    return { ...p, notional: n, weight: w[i] }
  })
  const total = rows.reduce((a, r) => a + r.notional, 0)
  rows.forEach((r) => (r.pctNet = total ? (r.notional / total) * 100 : 0))
  // funding sign: positive f1h → longs pay. Cost for our side (positive = we pay).
  rows.forEach((r) => (r.fundingUsd = r.f1h == null ? null : d * r.notional * r.f1h * 24 * OVERALL_DAYS))
  const lev = total / balance
  const mmrUse = rows.reduce((a, r) => a + r.notional * r.mmr, 0)
  const stress = [...new Set([...STRESS_SIGMAS, sigmaN])].sort((a, b) => a - b).map((k) => {
    const loss = rows.reduce((a, r) => a + r.notional * k * r.sigma, 0)
    return { k, lossUsd: loss, lossPctBal: (loss / balance) * 100, liquidated: loss >= balance - mmrUse }
  })
  // move (as multiple of each coin's σ) that would wipe the margin → liquidation buffer
  const sigUse = rows.reduce((a, r) => a + r.notional * r.sigma, 0)
  const liqInSigma = sigUse ? (balance - mmrUse) / sigUse : null
  return {
    d,
    side: d > 0 ? 'LONG' : 'SHORT',
    picks: rows,
    cands,
    desired,
    total,
    lev,
    scale,
    binding,
    shrunk: scale < 0.999,
    stress,
    liqInSigma,
    lossAtStop: sigUse,
    fundingUsd: rows.reduce((a, r) => a + (r.fundingUsd ?? 0), 0),
    margin: total / capLev,
  }
}
