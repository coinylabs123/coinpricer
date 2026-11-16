import { Fragment, useMemo, useState } from 'react'
import { useMacro, PERP_VENUE_KEYS } from '../hooks/useMacro.js'
import { VENUES } from '../api/perps.js'
import { biasFor, evaluateSignals, zoneFor } from '../utils/macroSignals.js'
import { FUNDING_BANDS, OI_BANDS, buildPerpRows } from '../utils/perpsAnalysis.js'
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
  { key: 'st', title: 'Short-term', span: 'days → ~2 weeks', basis: 'positioning & sentiment' },
  { key: 'mt', title: 'Medium-term', span: 'weeks → ~3 months', basis: 'liquidity & structure' },
]

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

function BiasPanel({ h, bias, loading }) {
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
        <span className="macro-weight" title="Weight in short-term / medium-term bias">
          {s.st ? `ST ${s.st}%` : ''}
          {s.st && s.mt ? ' · ' : ''}
          {s.mt ? `MT ${s.mt}%` : ''}
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
  { key: 'coin', label: 'Coin' },
  { key: 'fundingPct', label: 'Funding /8h', title: 'OI-weighted across venues, 8h-equivalent' },
  { key: 'annualizedPct', label: 'APR' },
  { key: 'predictedPct', label: 'Predicted /8h', title: 'Average of venues that publish a predicted/indicative next rate (OKX, Hyperliquid, Gate, dYdX)' },
  { key: 'okx24hPct', label: 'OKX 24h avg', title: 'Average settled funding over 24h (OKX funding-rate history)' },
  { key: 'okx7dPct', label: 'OKX 7d avg' },
  { key: 'nextFundingTime', label: 'Next funding', title: 'OKX next settlement, your local time' },
  { key: 'oiUsd', label: 'Open interest' },
  { key: 'oiPct', label: 'OI % mcap' },
  { key: 'premiumPct', label: 'Premium', title: 'Average (mark − index) / index across venues' },
  { key: 'positioning', label: 'Positioning' },
  { key: 'squeeze', label: 'Squeeze risk' },
]

function sortValue(row, key) {
  if (key === 'positioning') return row.fundingPct
  if (key === 'squeeze') return row.squeeze.level * (row.squeeze.side ?? 0) || 0
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
                <th key={c.key} title={c.title}>
                  <button
                    type="button"
                    className="th-sort"
                    onClick={() =>
                      setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))
                    }
                  >
                    {c.label}
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
                  <td className="perp-coin">
                    <span className="expander">{open.has(r.coin) ? '▾' : '▸'}</span> {r.coin}
                    <span className="perp-venue-count">{r.venues.length}v</span>
                  </td>
                  <td className={r.fundingPct < 0 ? 'change-down' : r.fundingPct > 0.01 ? 'change-up' : ''}>{spct(r.fundingPct)}</td>
                  <td>{spct(r.annualizedPct, 1)}</td>
                  <td>{spct(r.predictedPct)}</td>
                  <td>{spct(r.okx24hPct)}</td>
                  <td>{spct(r.okx7dPct)}</td>
                  <td className="nowrap">{timeUntil(r.nextFundingTime)}</td>
                  <td>{usd(r.oiUsd)}</td>
                  <td>
                    {pctf(r.oiPct)} <span className={`oi-tag oi-${r.oiLevel.key}`}>{r.oiLevel.label}</span>
                  </td>
                  <td>{spct(r.premiumPct, 3)}</td>
                  <td><span className={`pos-pill pos-${r.positioning.key}`}>{r.positioning.label}</span></td>
                  <td><span className={`sq-pill sq-${r.squeeze.key}`}>{r.squeeze.label}</span></td>
                </tr>
                {open.has(r.coin) && (
                  <tr className="perp-detail">
                    <td colSpan={PERP_COLS.length}>
                      <table className="venue-table">
                        <thead>
                          <tr>
                            <th>Venue</th>
                            <th>Funding /8h</th>
                            <th>APR</th>
                            <th>Interval</th>
                            <th>Predicted /8h</th>
                            <th>Next funding</th>
                            <th>OI</th>
                            <th>Mark</th>
                            <th>Index / oracle</th>
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
                              <td>{spct(v.funding8h == null ? null : v.funding8h * 100 * 3 * 365, 1)}</td>
                              <td>{v.intervalH ? `${v.intervalH}h` : '—'}</td>
                              <td>{spct(v.predicted8h == null ? null : v.predicted8h * 100)}</td>
                              <td className="nowrap">{timeUntil(v.nextFundingTime)}</td>
                              <td>{usd(v.oiUsd)}</td>
                              <td>{v.mark != null ? v.mark.toLocaleString() : '—'}</td>
                              <td>{v.index != null ? v.index.toLocaleString() : '—'}</td>
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
  const biases = useMemo(() => ({ st: biasFor(signals, 'st'), mt: biasFor(signals, 'mt') }), [signals])
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
          <BiasPanel key={h.key} h={h} bias={biases[h.key]} loading={anyLoading} />
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
            <strong>Short-term</strong> = funding 25%, leverage × funding 15%, Fear &amp; Greed today 20%, 24h market-cap
            move 10%, futures basis 10%, put/call 10%, options skew 10%.
          </li>
          <li>
            <strong>Medium-term</strong> = stablecoin supply 30d 25%, stablecoin supply 7d 10%, stablecoin dominance 20%,
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
          <li>Drivers = the three largest weighted contributions on each side.</li>
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
            24h OI change in a snapshot, so OI change isn&apos;t shown. Click a row for the per-venue breakdown (hover ⓘ for how each venue is normalised): OKX rate = current
            period, settling at the next funding time (OI = USDT + USD swaps); Hyperliquid and dYdX fund hourly (×8
            shown; OI × mark/oracle); Gate&apos;s predicted = its indicative rate; Deribit funding is continuous and shown
            as the trailing 8h rate.
          </li>
        </ul>
      </details>

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

      <p className="fine-print">
        Fetched directly from your browser once per page load (no keys, no polling): alternative.me, CoinGecko,
        DefiLlama, OKX, Hyperliquid, Gate.io, Bitget, Deribit and dYdX public APIs. Binance, Bybit, BitMEX, Kraken
        Futures, MEXC, KuCoin and Coinbase International were tested and left out (geo-blocked or no browser/CORS access).
      </p>
    </section>
  )
}
