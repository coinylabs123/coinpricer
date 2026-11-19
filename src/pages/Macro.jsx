import { Fragment, useMemo, useState } from 'react'
import { useMacro, PERP_VENUE_KEYS } from '../hooks/useMacro.js'
import { VENUES } from '../api/perps.js'
import { biasFor, evaluateSignals, zoneFor } from '../utils/macroSignals.js'
import { FUNDING_BANDS, OI_BANDS, buildPerpRows } from '../utils/perpsAnalysis.js'
import { actionFor, carryFor, crowdingHint } from '../utils/macroSignalsExtra.js'
import { formatCompact, formatUpdatedAt } from '../utils/format.js'

const usd = (v) => (v == null ? '—' : formatCompact(v, 'usd'))
const spct = (v, d = 4) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const pctf = (v, d = 2) => (v == null ? '—' : `${v.toFixed(d)}%`)

function timeUntil(ts) {
  if (!ts) return '—'
  const ms = ts - Date.now()
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
  if (ms <= 0) return time
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${time} (in ${h ? `${h}h ` : ''}${m}m)`
}

const HORIZONS = [
  { key: 'ust', title: 'Ultra-short', span: 'next 3–4 days', basis: 'derivatives flow & sentiment', carryDays: 3, crowding: true },
  { key: 'st', title: 'Short-term', span: 'days → ~2 weeks', basis: 'positioning & sentiment', ext: 'stExt', carryDays: 14, crowding: true },
  { key: 'mt', title: 'Medium-term', span: 'weeks → ~3 months', basis: 'liquidity & structure', ext: 'mtExt', carryDays: 30, carryBasis: '7d' },
]

function PerpRead({ h, bias, ext, ctx }) {
  const action = actionFor(bias)
  if (!action) return null
  const key = [...bias.pro, ...bias.con].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)
  const carry = carryFor(ctx.perpRows, h.carryDays, h.carryBasis)
  const crowd = h.crowding ? crowdingHint(ctx) : null
  const extAction = ext ? actionFor(ext) : null
  return (
    <div className="perp-read">
      <p className="perp-action">
        <span className="perp-action-label">Perp read</span>
        <span className={`action-pill action-${action.key}`}>{action.label}</span>
      </p>
      {key.length > 0 && (
        <p className="perp-read-line">
          <strong>Key drivers:</strong>{' '}
          {key.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ' · ' : ''}
              {d.title} ({d.value}) <span className={d.contribution > 0 ? 'drivers-bull' : 'drivers-bear'}>{d.contribution > 0 ? '▲' : '▼'}</span>
            </span>
          ))}
        </p>
      )}
      {crowd && (
        <p className="perp-read-line">
          <strong>Crowding / liquidation risk:</strong> {crowd}
        </p>
      )}
      {carry.length > 0 && (
        <p className="perp-read-line">
          <strong>Funding cost, {h.carryDays}d hold</strong>
          {h.carryBasis === '7d' ? ' (at OKX 7d avg)' : ' (at current funding)'}:{' '}
          {carry.map((c, i) => (
            <span key={c.coin}>
              {i > 0 ? ' · ' : ''}
              {c.coin} long {c.longPct >= 0 ? 'pays' : 'earns'} {Math.abs(c.longPct).toFixed(3)}%, short{' '}
              {c.longPct >= 0 ? 'earns' : 'pays'} {Math.abs(c.longPct).toFixed(3)}% of notional
            </span>
          ))}
          {' '}(×leverage on margin).
        </p>
      )}
      {ext && ext.score != null && (
        <p className="perp-read-line ext-read">
          <strong>With additional signals:</strong> {ext.call.label} ({ext.score > 0 ? '+' : ''}
          {ext.score.toFixed(2)}, {ext.confidence.label.toLowerCase()} confidence){extAction ? ` → ${extAction.label}` : ''}. The call
          above uses the original signals only.
        </p>
      )}
    </div>
  )
}

function Gauge({ score }) {
  // -1 (bearish) on the left, +1 (bullish) on the right.
  const pos = score == null ? 50 : ((score + 1) / 2) * 100
  return (
    <div className="gauge" aria-hidden="true">
      <div className="gauge-track gauge-track-bias">
        <span className="gauge-marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="gauge-labels">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
    </div>
  )
}

function BiasPanel({ h, bias, ext, ctx, loading }) {
  return (
    <div className={`bias-panel zone-${bias.call.key}`}>
      <div className="bias-head">
        <div>
          <h2>{h.title}</h2>
          <p className="bias-span">{h.span} · weighted to {h.basis}</p>
        </div>
        {bias.score != null && (
          <div className="bias-call">
            <span className={`zone-pill zone-pill-${bias.call.key} bias-pill`}>{bias.call.label}</span>
            <span className="bias-score">{bias.score > 0 ? '+' : ''}{bias.score.toFixed(2)}</span>
          </div>
        )}
      </div>
      {bias.score == null ? (
        <p className="macro-value muted">{loading ? 'Loading…' : 'Unavailable'}</p>
      ) : (
        <>
          <Gauge score={bias.score} />
          <PerpRead h={h} bias={bias} ext={ext} ctx={ctx} />
          <p className="bias-meta">
            Confidence <strong>{bias.confidence.label}</strong> ({Math.round(bias.confidence.value * 100)}%) · signal
            agreement {Math.round(bias.agreement * 100)}% · coverage {Math.round(bias.coverage * 100)}%
            {loading ? ' · still loading…' : ''}
          </p>
          <div className="bias-drivers">
            <div>
              <h4 className="drivers-bull">Bullish drivers</h4>
              {bias.pro.length ? (
                <ol>
                  {bias.pro.map((d) => (
                    <li key={d.id}>
                      <strong>{d.title}</strong> ({d.value}): {d.text}.{' '}
                      <span className="driver-w">+{d.contribution.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-text">None of note.</p>
              )}
            </div>
            <div>
              <h4 className="drivers-bear">Bearish drivers</h4>
              {bias.con.length ? (
                <ol>
                  {bias.con.map((d) => (
                    <li key={d.id}>
                      <strong>{d.title}</strong> ({d.value}): {d.text}.{' '}
                      <span className="driver-w">{d.contribution.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted-text">None of note.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SourceLinks({ sources }) {
  return (
    <span>
      {sources.map((src, i) => (
        <span key={src.label}>
          {i > 0 ? ' · ' : ''}
          <a href={src.home} target="_blank" rel="noreferrer">
            {src.label}
          </a>
        </span>
      ))}
    </span>
  )
}

function SignalCard({ s }) {
  const zone = zoneFor(s.score)
  return (
    <article className={`macro-card zone-${s.status === 'success' ? zone.key : 'na'}`}>
      <header className="macro-card-head">
        <h3>{s.title}</h3>
        <span className="macro-weight" title="Weight in ultra-short / short-term / medium-term bias (+ = additional-signal weight, not in the original ST/MT call)">
          {[
            s.ust ? `US ${s.ust}%` : null,
            s.st ? `ST ${s.st}%` : null,
            s.stx ? `+ST ${s.stx}` : null,
            s.mt ? `MT ${s.mt}%` : null,
            s.mtx ? `+MT ${s.mtx}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </header>
      {s.status === 'loading' && <p className="macro-value muted">Loading…</p>}
      {s.status === 'error' && (
        <>
          <p className="macro-value muted">Unavailable</p>
          {s.error && <p className="macro-context">{s.error}</p>}
        </>
      )}
      {s.status === 'success' && (
        <>
          <p className="macro-value">{s.value}</p>
          <div className="macro-zone-row">
            <span className={`zone-pill zone-pill-${zone.key}`}>{zone.label}</span>
            <span className="macro-score">score {s.score > 0 ? '+' : ''}{s.score.toFixed(2)}</span>
          </div>
          {s.context.length > 0 && (
            <ul className="macro-context">
              {s.context.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="macro-explain">{s.explain}</p>
      <p className="macro-rule"><strong>Rule:</strong> {s.rule}</p>
      <p className="macro-source">Source: <SourceLinks sources={s.sources} /></p>
    </article>
  )
}

const PERP_COLS = [
  { key: 'coin', label: 'Coin', className: 'perp-col-coin' },
  { key: 'tradeRead', label: 'Trade read', shortLabel: 'Read', title: 'Funding positioning + OI level + OI change → which side the setup favours. Hover a cell for detail', className: 'perp-col-main' },
  { key: 'fundingPct', label: 'Funding /8h', shortLabel: 'Funding', title: 'OI-weighted across venues, 8h-equivalent', className: 'perp-col-main' },
  { key: 'annualizedPct', label: 'APR', className: 'perp-col-optional' },
  { key: 'predictedPct', label: 'Predicted /8h', title: 'Average of venues that publish a predicted/indicative next rate (OKX, Hyperliquid, Gate, dYdX)', className: 'perp-col-optional' },
  { key: 'okx24hPct', label: 'OKX 24h avg', title: 'Average settled funding over 24h (OKX funding-rate history)', className: 'perp-col-optional' },
  { key: 'okx7dPct', label: 'OKX 7d avg', className: 'perp-col-optional' },
  { key: 'nextFundingTime', label: 'Next funding', title: 'OKX next settlement, your local time', className: 'perp-col-optional' },
  { key: 'oiUsd', label: 'Open interest', shortLabel: 'OI', className: 'perp-col-main' },
  { key: 'oiPct', label: 'OI % mcap', className: 'perp-col-optional' },
  { key: 'premiumPct', label: 'Premium', title: 'Average (mark − index) / index across venues', className: 'perp-col-optional' },
  { key: 'positioning', label: 'Positioning', className: 'perp-col-optional' },
  { key: 'squeeze', label: 'Squeeze risk', shortLabel: 'Squeeze', className: 'perp-col-main' },
  // v3 additions
  { key: 'binBybitPredPct', label: 'Binance/Bybit pred.', title: 'Average Binance + Bybit predicted next funding /8h (via Hyperliquid predictedFundings)', className: 'perp-col-optional' },
  { key: 'fundingMomentumPct', label: 'Funding Δ vs 24h', title: 'OKX current/predicted funding minus OKX 24h average (pts /8h). Rising = longs piling in', className: 'perp-col-optional' },
  { key: 'oiChange24hPct', label: 'OI 24h Δ', title: 'Open-interest change over ~24h on Gate.io (the only free CORS source with OI history)', className: 'perp-col-optional' },
  { key: 'carry3dLongPct', label: '3d cost (long)', title: 'Funding a long pays over 3 days (9 × 8h) at current funding, % of notional. Negative = long earns; shorts get the opposite', className: 'perp-col-optional' },
]

const READ_ORDER = { 'squeeze-long': 3, 'contra-long': 2, reset: 1, 'no-edge': 0, 'avoid-long': -1, 'fade-long': -2, na: null }

function sortValue(row, key) {
  if (key === 'positioning') return row.fundingPct
  if (key === 'squeeze') return row.squeeze.level * (row.squeeze.side ?? 0) || 0
  if (key === 'tradeRead') return READ_ORDER[row.tradeRead.key]
  return row[key]
}

function PerpsTable({ rows, venueStatus }) {
  const [sort, setSort] = useState({ key: 'oiUsd', dir: 'desc' })
  const [open, setOpen] = useState(() => new Set(['BTC']))
  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rows, sort])

  const toggle = (coin) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(coin)) n.delete(coin)
      else n.add(coin)
      return n
    })

  return (
    <>
      <p className="perps-venues">
        Venues:{' '}
        {PERP_VENUE_KEYS.map((k, i) => (
          <span key={k}>
            {i > 0 ? ' · ' : ''}
            <a href={VENUES[k].home} target="_blank" rel="noreferrer">{VENUES[k].label}</a>{' '}
            <span className={`venue-status venue-${venueStatus[k]}`}>
              {venueStatus[k] === 'success' ? '✓' : venueStatus[k] === 'loading' ? '…' : 'unavailable'}
            </span>
          </span>
        ))}
      </p>
      <div className="table-wrap perps-wrap">
        <table className="perps-table">
          <thead>
            <tr>
              {PERP_COLS.map((c) => (
                <th key={c.key} title={c.title} className={c.className}>
                  <button
                    type="button"
                    className="th-sort"
                    onClick={() =>
                      setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))
                    }
                  >
                    <span className="th-label-full">{c.label}</span>
                    <span className="th-label-short">{c.shortLabel || c.label}</span>
                    {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Fragment key={r.coin}>
                <tr className="perp-row" onClick={() => toggle(r.coin)}>
                  <td className="perp-coin perp-col-coin">
                    <span className="expander">{open.has(r.coin) ? '▾' : '▸'}</span> {r.coin}
                    <span className="perp-venue-count">{r.venues.length}v</span>
                  </td>
                  <td className="perp-col-main" title={r.tradeRead.title}>
                    <span className={`read-pill read-${r.tradeRead.key}`}>{r.tradeRead.label}</span>
                  </td>
                  <td className={`perp-col-main ${r.fundingPct < 0 ? 'change-down' : r.fundingPct > 0.01 ? 'change-up' : ''}`}>{spct(r.fundingPct)}</td>
                  <td className="perp-col-optional">{spct(r.annualizedPct, 1)}</td>
                  <td className="perp-col-optional">{spct(r.predictedPct)}</td>
                  <td className="perp-col-optional">{spct(r.okx24hPct)}</td>
                  <td className="perp-col-optional">{spct(r.okx7dPct)}</td>
                  <td className="nowrap perp-col-optional">{timeUntil(r.nextFundingTime)}</td>
                  <td className="perp-col-main">{usd(r.oiUsd)}</td>
                  <td className="perp-col-optional">
                    {pctf(r.oiPct)} <span className={`oi-tag oi-${r.oiLevel.key}`}>{r.oiLevel.label}</span>
                  </td>
                  <td className="perp-col-optional">{spct(r.premiumPct, 3)}</td>
                  <td className="perp-col-optional"><span className={`pos-pill pos-${r.positioning.key}`}>{r.positioning.label}</span></td>
                  <td className="perp-col-main"><span className={`sq-pill sq-${r.squeeze.key}`}>{r.squeeze.label}</span></td>
                  <td className="perp-col-optional">{spct(r.binBybitPredPct)}</td>
                  <td className={`perp-col-optional ${r.fundingMomentumPct > 0.002 ? 'change-up' : r.fundingMomentumPct < -0.002 ? 'change-down' : ''}`}>
                    {r.fundingMomentumPct == null ? '—' : `${r.fundingMomentumPct > 0 ? '+' : ''}${r.fundingMomentumPct.toFixed(4)}`}
                  </td>
                  <td className="perp-col-optional">{spct(r.oiChange24hPct, 1)}</td>
                  <td className="perp-col-optional">{spct(r.carry3dLongPct, 3)}</td>
                </tr>
                {open.has(r.coin) && (
                  <tr className="perp-detail">
                    <td colSpan={PERP_COLS.length}>
                      <table className="venue-table">
                        <thead>
                          <tr>
                            <th>Venue</th>
                            <th>Funding /8h</th>
                            <th className="venue-optional">APR</th>
                            <th className="venue-optional">Interval</th>
                            <th className="venue-optional">Predicted /8h</th>
                            <th className="venue-optional">Next funding</th>
                            <th>OI</th>
                            <th className="venue-optional">Mark</th>
                            <th className="venue-optional">Index / oracle</th>
                            <th>Premium</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.venues.map((v) => (
                            <tr key={v.venue}>
                              <td title={v.note}>
                                {v.venueLabel} <span className="venue-info" aria-label={v.note}>ⓘ</span>
                              </td>
                              <td>{spct(v.funding8h == null ? null : v.funding8h * 100)}</td>
                              <td className="venue-optional">{spct(v.funding8h == null ? null : v.funding8h * 100 * 3 * 365, 1)}</td>
                              <td className="venue-optional">{v.intervalH ? `${v.intervalH}h` : '—'}</td>
                              <td className="venue-optional">{spct(v.predicted8h == null ? null : v.predicted8h * 100)}</td>
                              <td className="nowrap venue-optional">{timeUntil(v.nextFundingTime)}</td>
                              <td>{usd(v.oiUsd)}</td>
                              <td className="venue-optional">{v.mark != null ? v.mark.toLocaleString() : '—'}</td>
                              <td className="venue-optional">{v.index != null ? v.index.toLocaleString() : '—'}</td>
                              <td>{spct(v.premium == null ? null : v.premium * 100, 3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Macro() {
  const { sources, updatedAt, reload } = useMacro()
  const perpRows = useMemo(() => buildPerpRows(sources), [sources])
  const signals = useMemo(() => evaluateSignals({ sources, perpRows }), [sources, perpRows])
  const biases = useMemo(
    () => ({
      ust: biasFor(signals, 'ust'),
      st: biasFor(signals, 'st'),
      mt: biasFor(signals, 'mt'),
      stExt: biasFor(signals, 'stExt'),
      mtExt: biasFor(signals, 'mtExt'),
    }),
    [signals],
  )
  const anyLoading = Object.values(sources).some((x) => x.status === 'loading')
  const loaded = signals.filter((s) => s.status === 'success').length
  const venueStatus = Object.fromEntries(PERP_VENUE_KEYS.map((k) => [k, sources[k].status]))

  return (
    <section className="macro">
      <div className="page-header">
        <div>
          <h1>Macro &amp; perps signals</h1>
          <p className="updated">
            {anyLoading
              ? 'Loading snapshot data…'
              : `Snapshot loaded ${formatUpdatedAt(updatedAt)} · ${loaded}/${signals.length} signals available`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={reload} disabled={anyLoading}>
          {anyLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="banner banner-warn macro-disclaimer" role="note">
        <strong>Heuristics, not financial advice.</strong> The bias calls below are mechanical rules of thumb applied
        to current snapshot data (sentiment, positioning, liquidity). They are not backtested, can stay wrong for weeks,
        and are no substitute for your own risk management — especially with leverage. No price history is used.
      </div>

      <h2 className="section-title">Bias</h2>
      <div className="bias-grid">
        {HORIZONS.map((h) => (
          <BiasPanel
            key={h.key}
            h={h}
            bias={biases[h.key]}
            ext={h.ext ? biases[h.ext] : null}
            ctx={{ perpRows, sources }}
            loading={anyLoading}
          />
        ))}
      </div>
      <details className="method">
        <summary>How the bias is calculated</summary>
        <ul>
          <li>
            Each signal scores −1 (bearish) … +1 (bullish). Contrarian readings count as bullish: extreme fear, negative
            funding, heavy put hedging, thin futures basis.
          </li>
          <li>
            <strong>Ultra-short (3–4 days)</strong> = perp funding 12%, funding momentum 10%, OI 24h change × funding
            10%, Binance/Bybit predicted funding 7%, perp premium 7%, short-dated (~7d) skew 7%, liquidations 24h 6%,
            taker buy/sell 6%, DVOL 24h change 6%, leverage × funding 5%, front-expiry put/call 5%, Fear &amp; Greed vs
            yesterday 5%, Fear &amp; Greed today 4%, retail long/short change 4%, 24h market-cap move 3%, DEX vs CEX
            funding divergence 3%.
          </li>
          <li>
            <strong>Short-term</strong> (unchanged) = funding 25%, leverage × funding 15%, Fear &amp; Greed today 20%, 24h market-cap
            move 10%, futures basis 10%, put/call 10%, options skew 10%.
          </li>
          <li>
            <strong>Medium-term</strong> (unchanged) = stablecoin supply 30d 25%, stablecoin supply 7d 10%, stablecoin dominance 20%,
            Fear &amp; Greed 7d avg 15%, BTC dominance 10%, ETH/BTC 10%, futures basis 10%.
          </li>
          <li>
            Bias = weighted average of available signals (missing ones are dropped and the rest re-weighted). ≥ +0.5
            Bullish · +0.2…+0.5 Lean bullish · −0.2…+0.2 Neutral · −0.5…−0.2 Lean bearish · ≤ −0.5 Bearish.
          </li>
          <li>
            Confidence = coverage × (½ × strength + ½ × agreement), where strength = |bias| / 0.6 (capped at 1) and
            agreement = share of weighted signal strength on the same side as the bias. High ≥ 60% · Medium ≥ 40% · Low
            below.
          </li>
          <li>
            <strong>Additional signals</strong> (shown as the &quot;With additional signals&quot; line; the main Short- and
            Medium-term calls ignore them, so the original calls are unchanged). Short-term adds, on top of its original
            100: Binance/Bybit predicted funding 10, OI 24h change × funding 10, liquidations 5, taker flow 5, IV term
            structure 5, basis term structure 5. Medium-term adds: DeFi TVL 30d 15, altcoin share 10, BTC hashrate 30d
            10, difficulty adjustment 5. The originals keep their relative weights.
          </li>
          <li>Drivers = the three largest weighted contributions on each side.</li>
          <li>
            <strong>Perp read</strong>: ≥ +0.5 Favour longs · +0.2…+0.5 Lean long, smaller size · ±0.2 Stay flat or
            reduce size · −0.2…−0.5 Lean short, smaller size · ≤ −0.5 Favour shorts. Low confidence adds &quot;cut
            size&quot;. Key drivers = the three largest contributions either way. Funding cost = OI-weighted funding /8h ×
            3 × days (current rate for 3d and 14d, OKX 7d average for 30d); assumes funding stays where it is, which it
            rarely does. Crowding uses BTC+ETH funding (≥ 0.03% crowded longs, ≤ −0.005% shorts paying), Gate.io OI
            change and Bitget account ratio.
          </li>
        </ul>
      </details>

      <h2 className="section-title">Perps: funding &amp; open interest</h2>
      <PerpsTable rows={perpRows} venueStatus={venueStatus} />
      <details className="method">
        <summary>Perps rules</summary>
        <ul>
          <li>
            All funding is converted to an 8-hour equivalent (hourly venues ×8, 4h venues ×2). APR = 8h rate × 3 × 365.
            The headline rate is weighted by each venue&apos;s open interest.
          </li>
          <li>
            Positioning (funding /8h): ≥ {FUNDING_BANDS.crowdedLong}% crowded longs · ≥ {FUNDING_BANDS.leanLong}% leaning
            long · {FUNDING_BANDS.leanShort}%…{FUNDING_BANDS.leanLong}% neutral · ≤ {FUNDING_BANDS.leanShort}% leaning short
            · ≤ {FUNDING_BANDS.crowdedShort}% crowded shorts.
          </li>
          <li>
            OI level (OI as % of market cap, visible venues only): ≥ {OI_BANDS.high}% high · ≥ {OI_BANDS.elevated}%
            elevated. Binance, Bybit and CME are not included (geo-blocked or no browser access), so totals understate the
            whole market.
          </li>
          <li>
            Squeeze risk: crowding points (2 crowded / 1 leaning) + OI points (2 high / 1 elevated). ≥4 High, 3 Medium, 2
            Low. Shorts paying + high OI → short-squeeze risk; longs paying + high OI → long-flush risk.
          </li>
          <li>
            OKX 24h / 7d averages come from OKX&apos;s funding-rate history (funding, not price). No venue here offers a
            24h OI change in a snapshot; the OI 24h Δ column comes from Gate.io&apos;s hourly contract stats (Gate only). Click a row for the per-venue breakdown (hover ⓘ for how each venue is normalised): OKX rate = current
            period, settling at the next funding time (OI = USDT + USD swaps); Hyperliquid and dYdX fund hourly (×8
            shown; OI × mark/oracle); Gate&apos;s predicted = its indicative rate; Deribit funding is continuous and shown
            as the trailing 8h rate.
          </li>
        </ul>
      </details>

      <h2 className="section-title">Ultra-short signals <span className="section-sub">3–4 day derivatives &amp; flow inputs (new)</span></h2>
      <div className="macro-grid">
        {signals.filter((s) => s.group === 'ultra').map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <h2 className="section-title">Positioning &amp; sentiment signals <span className="section-sub">short-term inputs</span></h2>
      <div className="macro-grid">
        {signals.filter((s) => s.group === 'positioning').map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <h2 className="section-title">Liquidity &amp; structure signals <span className="section-sub">medium-term inputs</span></h2>
      <div className="macro-grid">
        {signals.filter((s) => s.group === 'liquidity').map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <h2 className="section-title">Additional signals <span className="section-sub">new — feed only the &quot;with additional signals&quot; read, not the original calls</span></h2>
      <div className="macro-grid">
        {signals.filter((s) => s.group === 'extra-st' || s.group === 'extra-mt').map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>

      <p className="fine-print">
        Fetched directly from your browser once per page load (no keys, no polling): alternative.me, CoinGecko,
        DefiLlama, OKX, Hyperliquid, Gate.io, Bitget, Deribit, dYdX and mempool.space public APIs. Binance, Bybit, BitMEX, Kraken
        Futures, MEXC, KuCoin and Coinbase International were tested and left out (geo-blocked or no browser/CORS access);
        Binance and Bybit predicted funding comes via Hyperliquid. Also tested and left out: OKX rubik stats (OI
        history, taker volume, long/short — no CORS), DefiLlama DEX-volume overview (~2.5 MB per load) and DefiLlama
        derivatives overview (paid only). Gate.io contract stats include a mark-price field, which is ignored.
      </p>
    </section>
  )
}
