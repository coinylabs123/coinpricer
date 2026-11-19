// v3 signals: the Ultra-short (3–4 day) horizon plus "additional signals"
// for Short- and Medium-term.
//
// IMPORTANT: the original Short-term (st) and Medium-term (mt) signals,
// weights and logic in macroSignals.js are unchanged, so the original ST/MT
// calls are unchanged. New signals carry:
//   ust — weight in the new Ultra-short composite (sums to 100 together with
//         the existing signals that also got a `ust` weight)
//   stx — weight added on top of the original ST weights for the separate
//         "ST + additional signals" read (original ST weights stay 100)
//   mtx — same for Medium-term
//
// ULTRA-SHORT weights (total 100):
//   existing: perp funding 12 · leverage×funding 5 · Fear & Greed today 4 · 24h mcap move 3
//   new:      funding momentum 10 · OI 24h change×funding 10 · Binance/Bybit predicted funding 7 ·
//             perp premium 7 · short-dated skew 7 · liquidations 6 · taker flow 6 · DVOL 24h change 6 ·
//             front-expiry put/call 5 · Fear & Greed vs yesterday 5 · retail long/short change 4 ·
//             DEX vs CEX funding divergence 3
// ST additional (+40 on top of the original 100): Binance/Bybit predicted funding 10 ·
//   OI 24h change×funding 10 · liquidations 5 · taker flow 5 · IV term structure 5 · basis term structure 5
// MT additional (+40 on top of the original 100): DeFi TVL 30d 15 · altcoin share 10 ·
//   BTC hashrate 30d 10 · difficulty adjustment 5
//
// Thresholds are rules of thumb, not backtested. Not financial advice.
import { SOURCES } from '../api/macro.js'
import { EXTRA_SOURCES } from '../api/macroExtra.js'
import { formatCompact } from './format.js'
import { oiChange24hFor } from './perpsAnalysis.js'

const clamp = (v, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v))
function linear(value, bullAt, bearAt) {
  const mid = (bullAt + bearAt) / 2
  const half = (bullAt - bearAt) / 2
  return clamp((value - mid) / half)
}
const usd = (v) => formatCompact(v, 'usd')
const pct = (v, d = 2) => (v == null ? '—' : `${v.toFixed(d)}%`)
const spct = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const ok = (s) => s?.status === 'success' && s.data
const pending = (...xs) => (xs.some((s) => s?.status === 'loading') ? 'loading' : 'error')
const errOf = (...xs) => xs.find((s) => s?.error)?.error
const fail = (...xs) => ({ status: pending(...xs), error: errOf(...xs) })
const MAJORS = ['BTC', 'ETH']
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// Same funding scorer as the original "Perp funding" signal (copied, not changed).
export const fundingScore = (f) => (f <= 0.01 ? clamp((0.01 - f) / 0.02) : clamp(-(f - 0.01) / 0.04))

const majorsFunding = (perpRows) => {
  const rows = perpRows.filter((r) => MAJORS.includes(r.coin) && r.fundingPct != null)
  if (!rows.length) return null
  const w = rows.reduce((a, r) => a + (r.oiUsd || 1), 0)
  return rows.reduce((a, r) => a + r.fundingPct * (r.oiUsd || 1), 0) / w
}

export const EXTRA_SIGNALS = [
  // ---------------- Ultra-short (3–4 days): derivatives flow ----------------
  {
    id: 'fundingMomentum',
    group: 'ultra',
    title: 'Funding momentum (OKX now vs 24h avg)',
    st: 0, mt: 0, ust: 10,
    rule: 'BTC+ETH: (current & predicted OKX funding) − 24h average. ≤ −0.01 pts → +1 (funding cooling, longs unwinding); 0 → 0; ≥ +0.01 pts → −1 (longs piling in). Contrarian.',
    explain: 'Direction of funding matters for the next few days: funding climbing fast = fresh leveraged longs that can be flushed; funding falling = froth leaving.',
    bull: 'funding is cooling versus the last 24h — froth leaving',
    bear: 'funding is heating up versus the last 24h — longs piling in',
    sources: [SOURCES.okxHistory],
    score: (d) => linear(d, -0.01, 0.01),
    compute({ perpRows, sources }) {
      const items = perpRows
        .filter((r) => MAJORS.includes(r.coin))
        .map((r) => {
          const okx = r.venues.find((v) => v.venue === 'okx')
          const cur = [okx?.funding8h, okx?.predicted8h].filter((x) => x != null).map((x) => x * 100)
          if (!cur.length || r.okx24hPct == null) return null
          const now = avg(cur)
          return { coin: r.coin, now, base: r.okx24hPct, d: now - r.okx24hPct, w: okx?.oiUsd || 1 }
        })
        .filter(Boolean)
      if (!items.length) return fail(sources.okx, sources.okxHistory)
      const w = items.reduce((a, x) => a + x.w, 0)
      const d = items.reduce((a, x) => a + x.d * x.w, 0) / w
      return {
        status: 'success',
        raw: d,
        value: `${d > 0 ? '+' : ''}${d.toFixed(4)} pts`,
        context: items.map((x) => `${x.coin} now ${spct(x.now, 4)} vs 24h avg ${spct(x.base, 4)}`),
      }
    },
  },
  {
    id: 'oiChange',
    group: 'ultra',
    title: 'Open interest 24h change × funding',
    st: 0, mt: 0, ust: 10, stx: 10,
    rule: 'BTC+ETH OI change over ~24h (Gate.io, plus Binance when available; OI-weighted). OI rising: score = funding score × min(1, Δ/6%) (new leverage on the crowded side amplifies the contrarian read). OI falling: +0.4 × min(1, |Δ|/6%) (deleveraging clears the deck).',
    explain: 'OI change shows whether new leverage is entering. Rising OI with shorts paying = squeeze fuel; rising OI with hot funding = long-flush fuel.',
    bull: (x) => 'leverage is building on the short side or being flushed out — supportive',
    bear: 'new leverage is building on the long side — flush risk',
    sources: [EXTRA_SOURCES.gateStats, EXTRA_SOURCES.binance],
    score: (x) => x,
    compute({ perpRows, sources }) {
      if (!ok(sources.gateStats) && !ok(sources.binance)) return fail(sources.gateStats, sources.binance)
      const items = MAJORS.map((c) => ({ c, ...oiChange24hFor(c, sources) })).filter((x) => x.pct != null)
      if (!items.length) return { status: 'error', error: 'No OI history' }
      const w = items.reduce((a, x) => a + (x.oiUsd || 1), 0)
      const chg = items.reduce((a, x) => a + x.pct * (x.oiUsd || 1), 0) / w
      const f = majorsFunding(perpRows)
      if (f == null) return fail(sources.okx)
      const fs = fundingScore(f)
      const s = chg >= 0 ? fs * clamp(chg / 6, 0, 1) : 0.4 * clamp(-chg / 6, 0, 1)
      return {
        status: 'success',
        raw: s,
        value: `${spct(chg)} OI (24h)`,
        context: [
          ...items.map((x) => `${x.c} ${spct(x.pct)} → ${usd(x.oiUsd)} (${x.parts.map((p) => `${p.label} ${spct(p.pct, 1)}`).join(' · ')})`),
          `BTC+ETH funding ${spct(f, 4)} / 8h`,
        ],
      }
    },
  },
  {
    id: 'xvenueFunding',
    group: 'ultra',
    title: 'Binance + Bybit predicted funding',
    st: 0, mt: 0, ust: 7, stx: 10,
    rule: 'Same bands as Perp funding: ≤ −0.01%/8h → +1; +0.01% → 0; ≥ +0.05% → −1. BTC+ETH average of Binance and Bybit predicted next rates.',
    explain: 'Binance and Bybit are blocked from the browser, but Hyperliquid republishes their predicted funding — this adds the two biggest venues to the funding read.',
    bull: 'Binance/Bybit funding is at or below baseline — no long froth',
    bear: 'Binance/Bybit longs are paying up',
    sources: [EXTRA_SOURCES.hlPredicted],
    score: fundingScore,
    compute({ sources }) {
      if (!ok(sources.hlPredicted)) return fail(sources.hlPredicted)
      const d = sources.hlPredicted.data
      const vals = []
      const ctx = []
      for (const c of MAJORS) {
        const parts = ['binance', 'bybit'].map((v) => (d[c]?.[v] ? { v, r: d[c][v].rate8h * 100 } : null)).filter(Boolean)
        parts.forEach((p) => vals.push(p.r))
        if (parts.length) ctx.push(`${c} ${parts.map((p) => `${p.v === 'binance' ? 'Binance' : 'Bybit'} ${spct(p.r, 4)}`).join(' · ')}`)
      }
      if (!vals.length) return { status: 'error', error: 'No Binance/Bybit rows' }
      const f = avg(vals)
      return { status: 'success', raw: f, value: `${spct(f, 4)} / 8h`, context: ctx }
    },
  },
  {
    id: 'premium',
    group: 'ultra',
    title: 'Perp premium (mark vs index)',
    st: 0, mt: 0, ust: 7,
    rule: 'BTC+ETH average (mark − index)/index across venues: ≤ −0.05% → +1 (perps at a discount, sellers aggressive); 0 → 0; ≥ +0.05% → −1 (buyers chasing).',
    explain: 'The live perp premium leads the next funding print. A discount means aggressive shorting; a rich premium means leveraged buyers are chasing.',
    bull: 'perps trade at a discount — shorts pressing, contrarian bullish',
    bear: 'perps trade at a premium — longs chasing',
    sources: [SOURCES.perps],
    score: (p) => linear(p, -0.05, 0.05),
    compute({ perpRows, sources }) {
      const rows = perpRows.filter((r) => MAJORS.includes(r.coin) && r.premiumPct != null)
      if (!rows.length) return fail(sources.okx, sources.hyperliquid)
      const p = avg(rows.map((r) => r.premiumPct))
      return { status: 'success', raw: p, value: spct(p, 3), context: rows.map((r) => `${r.coin} ${spct(r.premiumPct, 3)}`) }
    },
  },
  {
    id: 'shortSkew',
    group: 'ultra',
    title: 'BTC short-dated skew (~7d, 5% OTM)',
    st: 0, mt: 0, ust: 7,
    rule: 'Put IV − call IV on the ~7-day expiry: ≥ +8 vol pts → +1 (panic hedging); +2 → 0; ≤ −4 → −1 (calls chased).',
    explain: 'Front-week skew reacts within hours. Very rich puts often mark short-term capitulation; bid calls mark FOMO.',
    bull: 'short-dated puts are expensive — near-term fear priced in',
    bear: 'short-dated calls are bid — near-term FOMO',
    sources: [SOURCES.deribitOptions],
    score: (v) => linear(v, 8, -4),
    compute({ sources }) {
      const sk = sources.deribitOptions.data?.shortSkew
      if (!sk) return { status: sources.deribitOptions.status === 'loading' ? 'loading' : 'error', error: sources.deribitOptions.error || 'No ~7d expiry' }
      return {
        status: 'success',
        raw: sk.skew,
        value: `${sk.skew > 0 ? '+' : ''}${sk.skew.toFixed(1)} vol pts`,
        context: [`${sk.dte.toFixed(1)}d expiry · ${sk.putStrike.toLocaleString()}P ${sk.putIv.toFixed(1)}% vs ${sk.callStrike.toLocaleString()}C ${sk.callIv.toFixed(1)}%`],
      }
    },
  },
  {
    id: 'liquidations',
    group: 'ultra',
    title: 'Liquidations last 24h (long vs short)',
    st: 0, mt: 0, ust: 6, stx: 5,
    rule: 'Gate.io, 8 tracked coins: (long liq − short liq)/(total) × size factor (total/$1M, clamped 0.25–1). Longs flushed → bullish (forced sellers done); shorts squeezed → bearish.',
    explain: 'Which side just got forced out. A long flush often marks a short-term low; a short squeeze often marks a short-term high. Gate is only one venue — treat as a hint.',
    bull: 'longs were the ones liquidated — forced selling is done',
    bear: 'shorts were the ones liquidated — squeeze may be exhausted',
    sources: [EXTRA_SOURCES.gateStats],
    score: (x) => x,
    compute({ sources }) {
      if (!ok(sources.gateStats)) return fail(sources.gateStats)
      const g = Object.values(sources.gateStats.data)
      const L = g.reduce((a, x) => a + (x.longLiqUsd || 0), 0)
      const S = g.reduce((a, x) => a + (x.shortLiqUsd || 0), 0)
      const tot = L + S
      const r = tot ? (L - S) / tot : 0
      return {
        status: 'success',
        raw: r * clamp(tot / 1e6, 0.25, 1),
        value: `${usd(L)} longs · ${usd(S)} shorts`,
        context: [tot ? `${Math.round((L / tot) * 100)}% of liquidations were longs (Gate.io only)` : 'No liquidations recorded'],
      }
    },
  },
  {
    id: 'takerFlow',
    group: 'ultra',
    title: 'Taker buy/sell ratio (24h)',
    st: 0, mt: 0, ust: 6, stx: 5,
    rule: 'Average of Bitget, Gate.io and Binance (when available) BTC+ETH taker buy ÷ sell over 24h: ≥ 1.10 → +1 (aggressive buying); 1.00 → 0; ≤ 0.90 → −1. Trend-following.',
    explain: 'Who is hitting the market — buyers lifting offers or sellers hitting bids. Persistent taker buying tends to carry price for a few days.',
    bull: 'takers are net buyers — aggressive demand',
    bear: 'takers are net sellers — aggressive supply',
    sources: [EXTRA_SOURCES.bitgetFlow, EXTRA_SOURCES.gateStats, EXTRA_SOURCES.binance],
    score: (r) => linear(r, 1.1, 0.9),
    compute({ sources }) {
      const vals = []
      const ctx = []
      for (const c of MAJORS) {
        const b = sources.bitgetFlow.data?.[c]?.takerRatio
        const g = sources.gateStats.data?.[c]?.takerRatio
        const n = sources.binance?.data?.stats?.[c]?.takerRatio
        if (b != null) vals.push(b)
        if (g != null) vals.push(g)
        if (n != null) vals.push(n)
        if (b != null || g != null || n != null)
          ctx.push(`${c} Bitget ${b != null ? b.toFixed(2) : '—'} · Gate ${g != null ? g.toFixed(2) : '—'} · Binance ${n != null ? n.toFixed(2) : '—'}`)
      }
      if (!vals.length) return fail(sources.bitgetFlow, sources.gateStats, sources.binance)
      const r = avg(vals)
      return { status: 'success', raw: r, value: r.toFixed(2), context: ctx }
    },
  },
  {
    id: 'dvol',
    group: 'ultra',
    title: 'BTC implied vol (DVOL) 24h change',
    st: 0, mt: 0, ust: 6,
    rule: 'DVOL change over 24h: ≥ +15% → +1 (vol spike = panic hedging, often near local lows); 0 → 0; ≤ −15% → −1 (vol crush = complacency).',
    explain: "Deribit's 30-day implied-volatility index (vol, not price). Sudden spikes come with fear; steady crushes come with complacency before moves.",
    bull: 'implied vol is spiking — fear/hedging, contrarian bullish',
    bear: 'implied vol is being crushed — complacency',
    sources: [EXTRA_SOURCES.dvol],
    score: (v) => linear(v, 15, -15),
    compute({ sources }) {
      const d = sources.dvol.data?.BTC
      if (!d) return fail(sources.dvol)
      const e = sources.dvol.data?.ETH
      return {
        status: 'success',
        raw: d.change24hPct,
        value: `${d.now.toFixed(1)} (${spct(d.change24hPct, 1)})`,
        context: [`48h range ${d.lo48h.toFixed(1)}–${d.hi48h.toFixed(1)}`, e ? `ETH DVOL ${e.now.toFixed(1)} (${spct(e.change24hPct, 1)})` : null].filter(Boolean),
      }
    },
  },
  {
    id: 'frontPcr',
    group: 'ultra',
    title: 'BTC put/call OI, nearest expiry',
    st: 0, mt: 0, ust: 5,
    rule: '≥ 1.20 → +1 (front-week hedging); 0.85 → 0; ≤ 0.50 → −1 (front-week call chasing). Contrarian.',
    explain: 'Put vs call open interest on the next Deribit expiry — positioning that matters over the next few days.',
    bull: 'front-week puts dominate — hedged, contrarian bullish',
    bear: 'front-week calls dominate — complacent',
    sources: [SOURCES.deribitOptions],
    score: (r) => linear(r, 1.2, 0.5),
    compute({ sources }) {
      const f = sources.deribitOptions.data?.frontPcr
      if (!f) return { status: sources.deribitOptions.status === 'loading' ? 'loading' : 'error', error: sources.deribitOptions.error || 'No front expiry' }
      return {
        status: 'success',
        raw: f.pcr,
        value: f.pcr.toFixed(2),
        context: [`${f.dte.toFixed(1)}d expiry · puts ${Math.round(f.putOi).toLocaleString()} vs calls ${Math.round(f.callOi).toLocaleString()} BTC`],
      }
    },
  },
  {
    id: 'fngDelta',
    group: 'ultra',
    title: 'Fear & Greed vs yesterday',
    st: 0, mt: 0, ust: 5,
    rule: 'Today − yesterday: ≤ −10 → +1 (sentiment dropped sharply, contrarian); 0 → 0; ≥ +10 → −1 (sudden euphoria).',
    explain: 'A sharp one-day swing in sentiment tends to overshoot and mean-revert within days.',
    bull: 'sentiment dropped sharply — contrarian bullish',
    bear: 'sentiment jumped sharply — contrarian bearish',
    sources: [SOURCES.fng],
    score: (d) => linear(d, -10, 10),
    compute({ sources }) {
      if (!ok(sources.fng) || sources.fng.data.length < 2) return fail(sources.fng)
      const [t, y] = sources.fng.data
      const d = t.value - y.value
      return { status: 'success', raw: d, value: `${d > 0 ? '+' : ''}${d} pts`, context: [`Today ${t.value} (${t.label}) · yesterday ${y.value} (${y.label})`] }
    },
  },
  {
    id: 'retailLs',
    group: 'ultra',
    title: 'Retail long/short accounts (24h change)',
    st: 0, mt: 0, ust: 4,
    rule: 'Average 24h change of the account long/short ratio (Bitget + Gate.io + Binance when available, BTC+ETH): ≤ −10% → +1 (crowd turning short, contrarian); 0 → 0; ≥ +10% → −1 (crowd piling long).',
    explain: 'Most retail accounts are long most of the time, so the level is less useful than the change. A crowd rushing to one side is the side that gets squeezed.',
    bull: 'the crowd is turning short — contrarian bullish',
    bear: 'the crowd is piling into longs — contrarian bearish',
    sources: [EXTRA_SOURCES.bitgetFlow, EXTRA_SOURCES.gateStats, EXTRA_SOURCES.binance],
    score: (v) => linear(v, -10, 10),
    compute({ sources }) {
      const vals = []
      const ctx = []
      for (const c of MAJORS) {
        const b = sources.bitgetFlow.data?.[c]
        const g = sources.gateStats.data?.[c]
        const n = sources.binance?.data?.stats?.[c]
        const gChg = g?.accountLsr != null && g?.accountLsrThen ? (g.accountLsr / g.accountLsrThen - 1) * 100 : null
        const nChg = n?.accountLsr != null && n?.accountLsrThen ? (n.accountLsr / n.accountLsrThen - 1) * 100 : null
        if (b?.accountLsrChangePct != null) vals.push(b.accountLsrChangePct)
        if (gChg != null) vals.push(gChg)
        if (nChg != null) vals.push(nChg)
        ctx.push(
          `${c} Bitget ${b?.accountLsr != null ? b.accountLsr.toFixed(2) : '—'} (${spct(b?.accountLsrChangePct ?? null, 1)}) · Gate ${g?.accountLsr != null ? g.accountLsr.toFixed(2) : '—'} (${spct(gChg, 1)}) · Binance ${n?.accountLsr != null ? n.accountLsr.toFixed(2) : '—'} (${spct(nChg, 1)})`,
        )
      }
      if (!vals.length) return fail(sources.bitgetFlow, sources.gateStats, sources.binance)
      const v = avg(vals)
      return { status: 'success', raw: v, value: spct(v, 1), context: ctx }
    },
  },
  {
    id: 'dexCexDivergence',
    group: 'ultra',
    title: 'DEX vs CEX funding divergence',
    st: 0, mt: 0, ust: 3,
    rule: 'BTC+ETH Hyperliquid/dYdX funding − OKX funding: ≤ −0.01 pts → +1; 0 → 0; ≥ +0.01 pts → −1 (on-chain degens paying more for longs).',
    explain: 'On-chain perp traders are often the most aggressive. When they pay much more than CEX traders to be long, the move is usually late.',
    bull: 'on-chain traders are less long than CEX — no degen froth',
    bear: 'on-chain traders are paying up for longs vs CEX',
    sources: [SOURCES.perps],
    score: (d) => linear(d, -0.01, 0.01),
    compute({ perpRows, sources }) {
      const items = perpRows
        .filter((r) => MAJORS.includes(r.coin))
        .map((r) => {
          const okx = r.venues.find((v) => v.venue === 'okx')?.funding8h
          const dex = r.venues.filter((v) => (v.venue === 'hyperliquid' || v.venue === 'dydx') && v.funding8h != null)
          if (okx == null || !dex.length) return null
          const dexF = avg(dex.map((v) => v.funding8h * 100))
          return { coin: r.coin, d: dexF - okx * 100, dexF, okx: okx * 100 }
        })
        .filter(Boolean)
      if (!items.length) return fail(sources.okx, sources.hyperliquid, sources.dydx)
      const d = avg(items.map((x) => x.d))
      return {
        status: 'success',
        raw: d,
        value: `${d > 0 ? '+' : ''}${d.toFixed(4)} pts`,
        context: items.map((x) => `${x.coin} DEX ${spct(x.dexF, 4)} vs OKX ${spct(x.okx, 4)}`),
      }
    },
  },

  // ---------------- Additional short-term (not in the original ST call) ----------------
  {
    id: 'ivTerm',
    group: 'extra-st',
    title: 'BTC IV term structure (~7d vs ~30d ATM)',
    st: 0, mt: 0, stx: 5,
    rule: 'Front ATM IV − 30d ATM IV: ≥ +5 vol pts → +1 (inverted = near-term stress, contrarian); 0 → 0; ≤ −5 → −1 (steep contango = calm/complacent).',
    explain: 'When near-dated options cost more than 30-day ones, traders are paying for immediate protection — typical around local lows.',
    bull: 'front-week vol is above 30-day — near-term stress priced in',
    bear: 'front-week vol is well below 30-day — near-term complacency',
    sources: [SOURCES.deribitOptions],
    score: (v) => linear(v, 5, -5),
    compute({ sources }) {
      const t = sources.deribitOptions.data?.ivTerm
      if (!t) return { status: sources.deribitOptions.status === 'loading' ? 'loading' : 'error', error: sources.deribitOptions.error || 'Expiries not found' }
      return {
        status: 'success',
        raw: t.spread,
        value: `${t.spread > 0 ? '+' : ''}${t.spread.toFixed(1)} vol pts`,
        context: [`${t.frontDte.toFixed(0)}d ATM ${t.frontIv.toFixed(1)}% · ${t.backDte.toFixed(0)}d ATM ${t.backIv.toFixed(1)}%`],
      }
    },
  },
  {
    id: 'basisTerm',
    group: 'extra-st',
    title: 'BTC basis term structure (front vs back)',
    st: 0, mt: 0, stx: 5,
    rule: 'Front-month annualised basis − furthest dated future: ≤ −5 pts → +1 (near-term demand weak); 0 → 0; ≥ +5 pts → −1 (near-term leverage hot).',
    explain: 'If the nearest future carries a richer annualised premium than the back months, leverage is concentrated in the near term — a short-term froth sign.',
    bull: 'near-dated futures are cheap vs back months — no near-term froth',
    bear: 'near-dated futures are rich vs back months — near-term leverage hot',
    sources: [SOURCES.deribitFutures],
    score: (v) => linear(v, -5, 5),
    compute({ sources }) {
      const t = sources.deribit.data?.basisTerm
      if (!t) return { status: sources.deribit.status === 'loading' ? 'loading' : 'error', error: sources.deribit.error || 'Not enough dated futures' }
      const d = t.front.annualizedPct - t.back.annualizedPct
      return {
        status: 'success',
        raw: d,
        value: `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`,
        context: [`${t.front.instrument} ${spct(t.front.annualizedPct, 1)} APR · ${t.back.instrument} ${spct(t.back.annualizedPct, 1)} APR`],
      }
    },
  },

  // ---------------- Additional medium-term (not in the original MT call) ----------------
  {
    id: 'tvl30',
    group: 'extra-mt',
    title: 'DeFi TVL (30d change)',
    st: 0, mt: 0, mtx: 15,
    rule: '≥ +10% → +1 (capital deploying on-chain); 0 → 0; ≤ −10% → −1. Trend-following. Note: TVL is in USD, so it also moves with prices.',
    explain: 'Total value locked across DeFi (DefiLlama). Rising TVL = capital being put to work on-chain; falling = de-risking.',
    bull: 'DeFi TVL is growing — capital deploying on-chain',
    bear: 'DeFi TVL is shrinking — capital de-risking',
    sources: [EXTRA_SOURCES.tvl],
    score: (v) => linear(v, 10, -10),
    compute({ sources }) {
      const d = sources.tvl.data
      if (!ok(sources.tvl) || d.change30d == null) return fail(sources.tvl)
      return { status: 'success', raw: d.change30d, value: spct(d.change30d, 1), context: [`TVL ${usd(d.tvl)} · 7d ${spct(d.change7d, 1)}`] }
    },
  },
  {
    id: 'altShare',
    group: 'extra-mt',
    title: 'Altcoin share (ex-BTC & ETH)',
    st: 0, mt: 0, mtx: 10,
    rule: '100 − BTC dom − ETH dom: ≤ 22% → +1 (alts washed out); 31% → 0; ≥ 40% → −1 (alt froth). Contrarian.',
    explain: 'How much of the market sits outside BTC and ETH (stablecoins included). Alt froth tends to peak late in a run.',
    bull: 'little money outside BTC/ETH — alts washed out',
    bear: 'lots of money in alts — late-cycle froth',
    sources: [SOURCES.global],
    score: (v) => linear(v, 22, 40),
    compute({ sources }) {
      const d = sources.global.data
      if (!ok(sources.global) || d.btcDom == null || d.ethDom == null) return fail(sources.global)
      const v = 100 - d.btcDom - d.ethDom
      return { status: 'success', raw: v, value: pct(v), context: [`BTC ${pct(d.btcDom)} · ETH ${pct(d.ethDom)}`] }
    },
  },
  {
    id: 'hashrate',
    group: 'extra-mt',
    title: 'BTC hashrate (30d trend)',
    st: 0, mt: 0, mtx: 10,
    rule: 'Last-7-day vs first-7-day average hashrate over 1 month: ≥ +8% → +1 (miners investing); 0 → 0; ≤ −8% → −1 (miner stress / capitulation risk).',
    explain: 'Hashrate rising = miners confident and adding machines. Falling hashrate can force miners to sell coins.',
    bull: 'hashrate is rising — miners investing',
    bear: 'hashrate is falling — miner stress',
    sources: [EXTRA_SOURCES.mempool],
    score: (v) => linear(v, 8, -8),
    compute({ sources }) {
      const d = sources.mempool.data
      if (!ok(sources.mempool) || d.hashChange30dPct == null) return fail(sources.mempool)
      return { status: 'success', raw: d.hashChange30dPct, value: spct(d.hashChange30dPct, 1), context: d.hashrateEh ? [`Current ~${d.hashrateEh.toFixed(0)} EH/s`] : [] }
    },
  },
  {
    id: 'difficulty',
    group: 'extra-mt',
    title: 'BTC next difficulty adjustment',
    st: 0, mt: 0, mtx: 5,
    rule: 'Estimated next change: ≥ +5% → +1; 0 → 0; ≤ −5% → −1. Small weight — confirms the hashrate trend.',
    explain: 'mempool.space estimate of the next difficulty retarget, based on block times in the current epoch.',
    bull: 'difficulty set to rise — network growing',
    bear: 'difficulty set to fall — hashrate leaving',
    sources: [EXTRA_SOURCES.mempool],
    score: (v) => linear(v, 5, -5),
    compute({ sources }) {
      const d = sources.mempool.data
      if (!ok(sources.mempool) || d.difficultyChangePct == null) return fail(sources.mempool)
      return {
        status: 'success',
        raw: d.difficultyChangePct,
        value: spct(d.difficultyChangePct, 1),
        context: [`Epoch ${pct(d.progressPct, 0)} done · previous ${spct(d.previousRetargetPct, 1)}`],
      }
    },
  },
]

// Ultra-short weights for EXISTING signals (added field only; st/mt untouched).
export const EXISTING_UST = { funding: 12, squeeze: 5, fng: 4, mcapChange: 3 }

// ---------------- Perp-actionable read per horizon ----------------
export function actionFor(bias) {
  if (bias.score == null) return null
  const s = bias.score
  let a
  if (s >= 0.5) a = { key: 'long', label: 'Favour longs' }
  else if (s >= 0.2) a = { key: 'lean-long', label: 'Lean long — smaller size' }
  else if (s > -0.2) a = { key: 'flat', label: 'Stay flat or reduce size' }
  else if (s > -0.5) a = { key: 'lean-short', label: 'Lean short — smaller size' }
  else a = { key: 'short', label: 'Favour shorts' }
  if (bias.confidence?.label === 'Low' && a.key !== 'flat') a = { ...a, label: `${a.label} (low confidence — cut size)` }
  return a
}

// Holding cost for a long on BTC/ETH over `days`, at the current OI-weighted
// funding (or OKX 7d avg for longer horizons). Positive = long pays.
export function carryFor(perpRows, days, basis = 'now') {
  return perpRows
    .filter((r) => MAJORS.includes(r.coin))
    .map((r) => {
      const f = basis === '7d' ? r.okx7dPct ?? r.fundingPct : r.fundingPct
      if (f == null) return null
      return { coin: r.coin, f, longPct: f * 3 * days }
    })
    .filter(Boolean)
}

// Crowding / liquidation hint from funding, OI change, retail ratio and liqs.
export function crowdingHint({ perpRows, sources }) {
  const f = majorsFunding(perpRows)
  if (f == null) return null
  const oi = oiChange24hFor('BTC', sources).pct
  const b = sources.bitgetFlow?.data?.BTC
  const parts = []
  let side
  if (f >= 0.03) side = 'longs'
  else if (f <= -0.005) side = 'shorts'
  else side = null
  const extra = [
    `funding ${spct(f, 4)}/8h`,
    oi != null ? `BTC OI ${spct(oi, 1)} 24h` : null,
    b?.accountLsr != null ? `Bitget BTC accounts ${b.accountLsr.toFixed(2)} L/S` : null,
  ].filter(Boolean).join(', ')
  if (side === 'longs') parts.push(`Longs look crowded (${extra}) — long-liquidation risk on a sharp dip.`)
  else if (side === 'shorts') parts.push(`Shorts are paying (${extra}) — short-squeeze risk on a pop.`)
  else parts.push(`Neither side is crowded on funding (${extra}).`)
  const g = sources.gateStats?.data
  if (g) {
    const L = Object.values(g).reduce((a, x) => a + (x.longLiqUsd || 0), 0)
    const S = Object.values(g).reduce((a, x) => a + (x.shortLiqUsd || 0), 0)
    if (L + S > 0) parts.push(`Last 24h on Gate.io: ${usd(L)} of longs vs ${usd(S)} of shorts liquidated.`)
  }
  return parts.join(' ')
}
