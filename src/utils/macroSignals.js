// Heuristic signal engine for the Macro tab.
// Every signal is mapped to a score in [-1, +1]:
//   +1 = BULLISH (includes contrarian readings such as extreme fear or negative funding)
//   -1 = BEARISH (e.g. euphoria, crowded longs, liquidity draining)
// Each signal carries a SHORT-TERM weight (days → ~2 weeks; positioning & sentiment)
// and a MEDIUM-TERM weight (weeks → ~3 months; liquidity & structure).
// Thresholds are rules of thumb, not backtested models. Not financial advice.
import { SOURCES, STABLE_IDS } from '../api/macro.js'
import { formatCompact } from './format.js'
import { EXISTING_UST, EXTRA_SIGNALS } from './macroSignalsExtra.js'

export const clamp = (v, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v))

// Linear map: value at `bullAt` -> +1, value at `bearAt` -> -1, clamped.
function linear(value, bullAt, bearAt) {
  const mid = (bullAt + bearAt) / 2
  const half = (bullAt - bearAt) / 2
  return clamp((value - mid) / half)
}

export function zoneFor(score) {
  if (score == null) return { key: 'na', label: 'Unavailable' }
  if (score >= 0.5) return { key: 'bull', label: 'Bullish' }
  if (score >= 0.2) return { key: 'lean-bull', label: 'Lean bullish' }
  if (score > -0.2) return { key: 'neutral', label: 'Neutral' }
  if (score > -0.5) return { key: 'lean-bear', label: 'Lean bearish' }
  return { key: 'bear', label: 'Bearish' }
}

const usd = (v) => formatCompact(v, 'usd')
const pct = (v, d = 2) => (v == null ? '—' : `${v.toFixed(d)}%`)
const spct = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)

const ok = (s) => s?.status === 'success' && s.data
const pending = (...xs) => (xs.some((s) => s?.status === 'loading') ? 'loading' : 'error')

// Signal definitions. `compute(ctx)` returns { status, value, raw, context, error }.
// v3: the original signals below are unchanged (st / mt weights and logic as
// before). The v3 Ultra-short horizon and the "additional signals" live in
// macroSignalsExtra.js and are appended to SIGNALS further down.
const BASE_SIGNALS = [
  // ---------- Positioning & sentiment (short-term) ----------
  {
    id: 'funding',
    group: 'positioning',
    title: 'Perp funding (BTC+ETH, OI-weighted)',
    st: 25,
    mt: 0,
    rule: '≤ −0.01%/8h → +1 (crowded shorts, contrarian bullish); +0.01% baseline → 0; ≥ +0.05% → −1 (crowded longs).',
    explain: 'What longs pay shorts every 8h, averaged across venues by open interest. Negative = shorts paying to stay short — fuel for squeezes.',
    bull: (f) =>
      f < 0
        ? 'shorts are paying longs — crowded short side, squeeze fuel'
        : 'funding is below the +0.01% baseline — no long-leverage froth',
    bear: 'longs are paying up — leverage skewed long, flush risk',
    sources: [SOURCES.perps],
    score: (f) => (f <= 0.01 ? clamp((0.01 - f) / 0.02) : clamp(-(f - 0.01) / 0.04)),
    compute({ perpRows, sources }) {
      const rows = perpRows.filter((r) => (r.coin === 'BTC' || r.coin === 'ETH') && r.fundingPct != null)
      if (!rows.length) return { status: pending(sources.okx, sources.hyperliquid, sources.gate, sources.bitget) }
      const w = rows.reduce((a, r) => a + (r.oiUsd || 1), 0)
      const f = rows.reduce((a, r) => a + r.fundingPct * (r.oiUsd || 1), 0) / w
      return {
        status: 'success',
        raw: f,
        value: `${spct(f, 4)} / 8h`,
        context: [
          ...rows.map((r) => `${r.coin} ${spct(r.fundingPct, 4)} (${spct(r.annualizedPct, 1)} APR) · ${r.venues.length} venues`),
        ],
      }
    },
  },
  {
    id: 'squeeze',
    group: 'positioning',
    title: 'Leverage × funding (squeeze setup)',
    st: 15,
    mt: 0,
    rule: 'OI heat h = (OI/mcap − 0.5%) / 1.5%, clamped 0–1. Score = funding score (above) × h. High OI + negative funding → bullish squeeze setup; high OI + hot funding → bearish flush setup; low OI → ~0.',
    explain: 'Funding only matters if there is enough leverage to unwind. Uses BTC+ETH perp OI on the venues we can see, as a share of their market cap.',
    bull: 'OI is elevated while funding sits below baseline — leans toward a short squeeze',
    bear: 'leverage is built up on the long side — long-liquidation setup',
    sources: [SOURCES.perps, SOURCES.prices],
    score: (x) => x,
    compute({ perpRows, sources }) {
      const rows = perpRows.filter((r) => (r.coin === 'BTC' || r.coin === 'ETH') && r.oiUsd && r.mcap && r.fundingPct != null)
      if (!rows.length) return { status: pending(sources.okx, sources.prices) }
      const oi = rows.reduce((a, r) => a + r.oiUsd, 0)
      const mc = rows.reduce((a, r) => a + r.mcap, 0)
      const L = (oi / mc) * 100
      const h = clamp((L - 0.5) / 1.5, 0, 1)
      const f = rows.reduce((a, r) => a + r.fundingPct * r.oiUsd, 0) / oi
      const fs = SIGNALS[0].score(f)
      return {
        status: 'success',
        raw: fs * h,
        value: `OI ${pct(L)} of mcap`,
        context: [`BTC+ETH perp OI ${usd(oi)} (visible venues)`, `OI heat ${(h * 100).toFixed(0)}% · funding score ${fs > 0 ? '+' : ''}${fs.toFixed(2)}`],
      }
    },
  },
  {
    id: 'fng',
    group: 'positioning',
    title: 'Fear & Greed (today)',
    st: 20,
    mt: 0,
    rule: '≤20 extreme fear → +1; 50 → 0; ≥80 extreme greed → −1. Linear in between. Contrarian.',
    explain: 'Crowd sentiment. Extreme fear tends to cluster near local lows, extreme greed near local highs.',
    bull: 'extreme fear — contrarian bullish',
    bear: 'greed — crowd is complacent, contrarian bearish',
    sources: [SOURCES.fng],
    score: (v) => linear(v, 20, 80),
    compute({ sources }) {
      if (!ok(sources.fng)) return { status: pending(sources.fng), error: sources.fng.error }
      const now = sources.fng.data[0]
      return { status: 'success', raw: now.value, value: `${now.value} · ${now.label}`, context: [] }
    },
  },
  {
    id: 'mcapChange',
    group: 'positioning',
    title: 'Total market cap 24h change',
    st: 10,
    mt: 0,
    rule: '≤ −8% → +1 (capitulation-style day); 0% → 0; ≥ +8% → −1 (blow-off-style day). Contrarian at extremes.',
    explain: 'Very large one-day moves are often exhaustion. Small moves barely register.',
    bull: 'a heavy down day — short-term exhaustion likely',
    bear: 'a big up day — short-term exhaustion likely',
    sources: [SOURCES.global],
    score: (v) => linear(v, -8, 8),
    compute({ sources }) {
      const d = sources.global.data
      if (!ok(sources.global) || d.mcapChange24h == null) return { status: pending(sources.global), error: sources.global.error }
      return { status: 'success', raw: d.mcapChange24h, value: spct(d.mcapChange24h), context: [`Total market cap ${usd(d.totalMcapUsd)}`] }
    },
  },
  {
    id: 'basis',
    group: 'positioning',
    title: 'BTC futures basis (annualised)',
    st: 10,
    mt: 10,
    rule: '≤0% → +1 (backwardation, fear); 8% → 0; ≥16% → −1 (leveraged froth). Uses the Deribit dated future closest to 90 days.',
    explain: 'The premium of dated futures over spot, annualised. Rich basis = leveraged longs paying up for exposure; flat/negative = no appetite.',
    bull: 'futures premium is thin — little leveraged froth',
    bear: 'futures premium is rich — leveraged longs paying up',
    sources: [SOURCES.deribitFutures],
    score: (v) => linear(v, 0, 16),
    compute({ sources }) {
      const b = sources.deribit.data?.basis
      if (!b) return { status: sources.deribit.status === 'loading' ? 'loading' : 'error', error: sources.deribit.error || 'No dated future found' }
      return {
        status: 'success',
        raw: b.annualizedPct,
        value: `${spct(b.annualizedPct)} APR`,
        context: [`${b.instrument} · ${Math.round(b.dte)} days · mark $${b.mark.toLocaleString()} vs index $${b.index.toLocaleString()}`],
      }
    },
  },
  {
    id: 'pcr',
    group: 'positioning',
    title: 'BTC options put/call OI',
    st: 10,
    mt: 0,
    rule: '≥0.90 → +1 (heavy hedging); 0.65 → 0; ≤0.40 → −1 (call euphoria). Contrarian.',
    explain: 'Put vs call open interest on Deribit. Lots of puts = defensive positioning; very few = complacency.',
    bull: 'traders are heavily hedged — contrarian bullish',
    bear: 'few hedges, lots of calls — complacency',
    sources: [SOURCES.deribitOptions],
    score: (r) => linear(r, 0.9, 0.4),
    compute({ sources }) {
      if (!ok(sources.deribitOptions)) return { status: pending(sources.deribitOptions), error: sources.deribitOptions.error }
      const d = sources.deribitOptions.data
      return {
        status: 'success',
        raw: d.pcr,
        value: d.pcr.toFixed(2),
        context: [`Puts ${Math.round(d.putOi).toLocaleString()} BTC · Calls ${Math.round(d.callOi).toLocaleString()} BTC`],
      }
    },
  },
  {
    id: 'skew',
    group: 'positioning',
    title: 'BTC options skew (~30d, 10% OTM)',
    st: 10,
    mt: 0,
    rule: 'Put IV − call IV: ≥ +8 vol pts → +1 (fear priced in); +2 → 0; ≤ −4 → −1 (calls bid, FOMO).',
    explain: 'How much more traders pay for downside protection than upside. Very rich puts = fear; rich calls = chasing.',
    bull: 'downside protection is expensive — fear priced in',
    bear: 'upside calls are bid over puts — FOMO',
    sources: [SOURCES.deribitOptions],
    score: (v) => linear(v, 8, -4),
    compute({ sources }) {
      const sk = sources.deribitOptions.data?.skew
      if (!sk) return { status: sources.deribitOptions.status === 'loading' ? 'loading' : 'error', error: sources.deribitOptions.error || 'No suitable expiry' }
      return {
        status: 'success',
        raw: sk.skew,
        value: `${sk.skew > 0 ? '+' : ''}${sk.skew.toFixed(1)} vol pts`,
        context: [`${Math.round(sk.dte)}d expiry · ${sk.putStrike.toLocaleString()}P ${sk.putIv.toFixed(1)}% vs ${sk.callStrike.toLocaleString()}C ${sk.callIv.toFixed(1)}%`],
      }
    },
  },

  // ---------- Liquidity & structure (medium-term) ----------
  {
    id: 'stableFlow30',
    group: 'liquidity',
    title: 'Stablecoin supply (30d change)',
    st: 0,
    mt: 25,
    rule: '≥ +3% → +1 (fresh liquidity arriving); 0% → 0; ≤ −3% → −1 (liquidity leaving). Trend-following, not contrarian.',
    explain: 'Net minting of stablecoins = new buying power entering crypto; net redemptions = capital leaving.',
    bull: 'stablecoins are being minted — new money arriving',
    bear: 'stablecoins are being redeemed — money leaving crypto',
    sources: [SOURCES.llama],
    score: (v) => linear(v, 3, -3),
    compute({ sources }) {
      const d = sources.llama.data
      if (!ok(sources.llama) || d.change30d == null) return { status: pending(sources.llama), error: sources.llama.error }
      return { status: 'success', raw: d.change30d, value: spct(d.change30d), context: [`Total supply ${usd(d.totalUsd)}`] }
    },
  },
  {
    id: 'stableFlow7',
    group: 'liquidity',
    title: 'Stablecoin supply (7d change)',
    st: 0,
    mt: 10,
    rule: '≥ +1% → +1; 0% → 0; ≤ −1% → −1. Shows whether the 30d trend is accelerating or turning.',
    explain: 'The most recent week of stablecoin minting/redemption.',
    bull: 'stablecoin supply grew this week',
    bear: 'stablecoin supply shrank this week',
    sources: [SOURCES.llama],
    score: (v) => linear(v, 1, -1),
    compute({ sources }) {
      const d = sources.llama.data
      if (!ok(sources.llama) || d.change7d == null) return { status: pending(sources.llama), error: sources.llama.error }
      return { status: 'success', raw: d.change7d, value: spct(d.change7d), context: [] }
    },
  },
  {
    id: 'stableDom',
    group: 'liquidity',
    title: 'Stablecoin dominance',
    st: 0,
    mt: 20,
    rule: '≥13% → +1 (lots of sidelined dry powder); 9.5% → 0; ≤6% → −1 (fully deployed). Contrarian level.',
    explain: 'Share of total crypto market cap parked in stablecoins. High = cash waiting on the sidelines; low = money already in risk assets.',
    bull: 'lots of cash parked on the sidelines',
    bear: 'little cash left on the sidelines',
    sources: [SOURCES.global, SOURCES.prices],
    score: (v) => linear(v, 13, 6),
    compute({ sources }) {
      if (!ok(sources.global) || !ok(sources.prices)) return { status: pending(sources.global, sources.prices), error: sources.global.error || sources.prices.error }
      const p = sources.prices.data
      const cap = STABLE_IDS.reduce((a, id) => a + (Number(p[id]?.usd_market_cap) || 0), 0)
      const dom = (cap / sources.global.data.totalMcapUsd) * 100
      const alt = sources.global.data.btcDom != null ? 100 - sources.global.data.btcDom - dom : null
      return {
        status: 'success',
        raw: dom,
        value: pct(dom),
        context: [`Stables ${usd(cap)} of ${usd(sources.global.data.totalMcapUsd)}`, alt != null ? `Altcoin share ${pct(alt)}` : null].filter(Boolean),
      }
    },
  },
  {
    id: 'fng7',
    group: 'liquidity',
    title: 'Fear & Greed (7d / 30d context)',
    st: 0,
    mt: 15,
    rule: '7-day average: ≤20 → +1; 50 → 0; ≥80 → −1. Smoothed sentiment for the bigger picture.',
    explain: 'A week of persistent fear is a stronger contrarian signal than a single day.',
    bull: 'a week of persistent fear — sentiment washed out',
    bear: 'a week of persistent greed — sentiment stretched',
    sources: [SOURCES.fng],
    score: (v) => linear(v, 20, 80),
    compute({ sources }) {
      if (!ok(sources.fng)) return { status: pending(sources.fng), error: sources.fng.error }
      const vals = sources.fng.data.map((r) => r.value)
      const a7 = vals.slice(0, 7).reduce((a, b) => a + b, 0) / Math.min(7, vals.length)
      const a30 = vals.reduce((a, b) => a + b, 0) / vals.length
      return {
        status: 'success',
        raw: a7,
        value: `7d avg ${a7.toFixed(0)}`,
        context: [`${vals.length}d avg ${a30.toFixed(0)} · range ${Math.min(...vals)}–${Math.max(...vals)}`],
      }
    },
  },
  {
    id: 'btcDom',
    group: 'liquidity',
    title: 'BTC dominance',
    st: 0,
    mt: 10,
    rule: '≥60% → +1 (alts washed out); 52% → 0; ≤44% → −1 (alt-season froth).',
    explain: 'Late-cycle euphoria shows up as rotation out of BTC into alts; washed-out markets concentrate in BTC.',
    bull: 'money is concentrated in BTC — alts washed out',
    bear: 'money has rotated into alts — late-cycle froth',
    sources: [SOURCES.global],
    score: (v) => linear(v, 60, 44),
    compute({ sources }) {
      const d = sources.global.data
      if (!ok(sources.global) || d.btcDom == null) return { status: pending(sources.global), error: sources.global.error }
      return { status: 'success', raw: d.btcDom, value: pct(d.btcDom), context: d.ethDom != null ? [`ETH dominance ${pct(d.ethDom)}`] : [] }
    },
  },
  {
    id: 'ethBtc',
    group: 'liquidity',
    title: 'ETH/BTC ratio',
    st: 0,
    mt: 10,
    rule: '≤0.030 → +1 (alts deeply out of favour); 0.050 → 0; ≥0.070 → −1 (risk appetite stretched).',
    explain: 'ETH vs BTC from current spot prices — a rough risk-appetite thermometer.',
    bull: 'ETH is deeply out of favour vs BTC — risk appetite washed out',
    bear: 'ETH is strong vs BTC — risk appetite stretched',
    sources: [SOURCES.prices],
    score: (r) => linear(r, 0.03, 0.07),
    compute({ sources }) {
      const p = sources.prices.data
      if (!ok(sources.prices) || !p.bitcoin?.usd || !p.ethereum?.usd) return { status: pending(sources.prices), error: sources.prices.error }
      const r = p.ethereum.usd / p.bitcoin.usd
      return { status: 'success', raw: r, value: r.toFixed(5), context: [`ETH $${p.ethereum.usd.toLocaleString()} · BTC $${p.bitcoin.usd.toLocaleString()}`] }
    },
  },
]

// Original signals (+ an Ultra-short weight on four of them) followed by the v3 signals.
export const SIGNALS = [
  ...BASE_SIGNALS.map((s) => (EXISTING_UST[s.id] ? { ...s, ust: EXISTING_UST[s.id] } : s)),
  ...EXTRA_SIGNALS,
]

export function evaluateSignals(ctx) {
  return SIGNALS.map((def) => {
    let res
    try {
      res = def.compute(ctx)
    } catch (e) {
      res = { status: 'error', error: e?.message }
    }
    const score = res.status === 'success' && res.raw != null ? def.score(res.raw) : null
    // stExt / mtExt = original weight + additional weight, used only for the
    // separate "with additional signals" read; the original st / mt calls ignore them.
    return {
      ...def,
      ...res,
      context: res.context ?? [],
      score,
      ust: def.ust ?? 0,
      stExt: (def.st || 0) + (def.stx || 0),
      mtExt: (def.mt || 0) + (def.mtx || 0),
    }
  })
}

// Bias for one horizon ('ust' | 'st' | 'mt' | 'stExt' | 'mtExt').
// score      = Σ(w·s) / Σ(w) over available signals
// agreement  = Σ(w·|s|) on the same side as the score / Σ(w·|s|)
// confidence = coverage × (0.5·min(1, |score|/0.6) + 0.5·agreement)  → High ≥0.6 · Medium ≥0.4 · Low
export function biasFor(signals, horizon) {
  const items = signals.filter((s) => s[horizon] > 0)
  const wTotal = items.reduce((a, s) => a + s[horizon], 0)
  const avail = items.filter((s) => s.score != null)
  const wAvail = avail.reduce((a, s) => a + s[horizon], 0)
  if (!wAvail) return { score: null, call: zoneFor(null), coverage: 0, confidence: null, pro: [], con: [] }
  const score = avail.reduce((a, s) => a + s[horizon] * s.score, 0) / wAvail
  const mag = avail.reduce((a, s) => a + s[horizon] * Math.abs(s.score), 0)
  const same = avail
    .filter((s) => Math.sign(s.score) === Math.sign(score) && s.score !== 0)
    .reduce((a, s) => a + s[horizon] * Math.abs(s.score), 0)
  const agreement = mag ? same / mag : 0
  const coverage = wAvail / wTotal
  const confVal = coverage * (0.5 * Math.min(1, Math.abs(score) / 0.6) + 0.5 * agreement)
  const confidence = { value: confVal, label: confVal >= 0.6 ? 'High' : confVal >= 0.4 ? 'Medium' : 'Low' }
  const contrib = avail.map((s) => ({
    id: s.id,
    title: s.title,
    value: s.value,
    contribution: (s[horizon] * s.score) / wAvail,
    text: (() => {
      const t = s.score >= 0 ? s.bull : s.bear
      return typeof t === 'function' ? t(s.raw) : t
    })(),
  }))
  const pro = contrib.filter((c) => c.contribution > 0.005).sort((a, b) => b.contribution - a.contribution).slice(0, 3)
  const con = contrib.filter((c) => c.contribution < -0.005).sort((a, b) => a.contribution - b.contribution).slice(0, 3)
  return { score, call: zoneFor(score), coverage, agreement, confidence, pro, con }
}
