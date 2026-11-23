import { useMemo, useState } from 'react'
import { useMacro } from '../hooks/useMacro.js'
import { useRateLimitNotice } from '../hooks/useRateLimitNotice.js'
import { buildPerpRows } from '../utils/perpsAnalysis.js'
import { evaluateTrend } from '../utils/trendAnalysis.js'
import { formatUpdatedAt } from '../utils/format.js'

const INDICATORS_KEY = 'coinpricer.trendIndicators'
const GROUPS = [
  { key: 'C', title: 'Continuation', cls: 'cont' },
  { key: 'R', title: 'Reversal', cls: 'rev' },
  { key: 'G', title: 'Ranging', cls: 'range' },
]

const spct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const pctInt = (p) => `${Math.round(p * 100)}%`

function loadIndicatorOpen() {
  try {
    const raw = JSON.parse(localStorage.getItem(INDICATORS_KEY) || '{}')
    return {
      ust: raw.ust !== false,
      st: raw.st !== false,
      mt: raw.mt !== false,
    }
  } catch {
    return { ust: true, st: true, mt: true }
  }
}

function itemState(item) {
  const name = item.cls === 'C' ? 'continuation' : item.cls === 'R' ? 'reversal' : 'ranging'
  if (item.v == null) return { key: 'na', label: 'No data', name }
  if (item.v >= 0.6) return { key: 'supports', label: `Supports ${name}`, name }
  if (item.v >= 0.3) return { key: 'lean', label: `Lean ${name}`, name }
  return { key: 'neutral', label: 'Neutral', name }
}

function Bar({ name, arrow, p, top, kind }) {
  return (
    <div className={top ? 'trend-row trend-top' : 'trend-row'}>
      <span className="trend-name">
        {name}
        {arrow && <span className="trend-arrow"> {arrow}</span>}
      </span>
      <span className="trend-track" aria-hidden="true">
        <span className={`trend-fill trend-${kind}`} style={{ width: `${p * 100}%` }} />
      </span>
      <span className="trend-pct">{pctInt(p)}</span>
    </div>
  )
}

function IndicatorCard({ item }) {
  const state = itemState(item)
  const zone = state.key === 'na' || state.key === 'neutral' ? 'neutral' : `${state.key}-${item.cls === 'C' ? 'cont' : item.cls === 'R' ? 'rev' : 'range'}`
  return (
    <article className={`macro-card trend-ind zone-${zone}`}>
      <header className="macro-card-head">
        <h3>{item.label}</h3>
        <span className="macro-weight" title="Weight in this horizon's evidence">
          {item.weight}
        </span>
      </header>
      {state.key === 'na' ? (
        <p className="macro-value muted">No data</p>
      ) : (
        <p className="macro-value">{item.text}</p>
      )}
      <div className="macro-zone-row">
        <span className={`zone-pill zone-pill-${state.key} zone-pill-${item.cls === 'C' ? 'cont' : item.cls === 'R' ? 'rev' : 'range'}`}>{state.label}</span>
      </div>
    </article>
  )
}

function TrendCard({ t, loadingPrices, indicatorsOpen, onToggleIndicators }) {
  if (t.status !== 'success') {
    return (
      <article className="macro-card trend-card">
        <header className="trend-head">
          <h3>{t.title}</h3>
          <span className="trend-span">{t.span}</span>
        </header>
        <p className="macro-value muted">{loadingPrices ? 'Loading…' : 'Price snapshot unavailable'}</p>
      </article>
    )
  }
  const { dir } = t
  const up = dir.u > 0
  const flat = dir.strengthLabel === 'no clear trend'
  const arrow = up ? '▲' : '▼'
  const rev = up ? '▼' : '▲'
  const topKey = t.top
  return (
    <section className="trend-block">
      <article className={`macro-card trend-card ${flat ? 'zone-neutral' : up ? 'zone-bull' : 'zone-bear'}`}>
        <header className="trend-head">
          <h3>{t.title}</h3>
          <span className="trend-span">{t.span}</span>
        </header>

        <p className={`trend-dir ${flat ? '' : up ? 'trend-up' : 'trend-down'}`}>
          {flat ? (
            <>
              <strong>↔ No clear trend</strong>
              <span className="trend-dir-note"> · leaning {arrow}</span>
            </>
          ) : (
            <>
              <strong>
                {arrow} {up ? 'Uptrend' : 'Downtrend'}
              </strong>
              <span className="trend-dir-note"> · {dir.strengthLabel}</span>
            </>
          )}
        </p>
        <p className="trend-windows">
          {dir.windows.map((w, i) => (
            <span key={w.k}>
              {i > 0 ? ' · ' : ''}
              {w.k} {spct(w.btc)}
            </span>
          ))}{' '}
          <span className="trend-windows-tag">BTC</span>
        </p>

        <div className="trend-bars">
          <Bar name="Continuation" arrow={arrow} p={t.probs.continuation} top={topKey === 'continuation'} kind="cont" />
          <Bar name="Reversal" arrow={`→ ${rev}`} p={t.probs.reversal} top={topKey === 'reversal'} kind="rev" />
          <Bar name="Ranging" p={t.probs.ranging} top={topKey === 'ranging'} kind="range" />
        </div>

        <p className="trend-drivers">
          {t.drivers.length ? (
            <>
              <strong>Drivers:</strong> {t.drivers.map((d) => `${d.label} (${d.text})`).join(' · ')}
            </>
          ) : (
            <span className="muted">No single driver stands out</span>
          )}
        </p>
        <p className="trend-conf">
          {t.confidence} confidence · {Math.round(t.coverage * 100)}% data coverage
          {dir.ivFallback ? ' · DVOL unavailable (60 assumed)' : ''}
        </p>
      </article>

      <details
        className="trend-inds"
        open={indicatorsOpen}
        onToggle={(e) => onToggleIndicators(e.currentTarget.open)}
      >
        <summary>Indicators</summary>
        {GROUPS.map((g) => (
          <div key={g.key} className="trend-group">
            <h3 className={`section-title trend-group-title trend-group-${g.cls}`}>{g.title}</h3>
            <div className="macro-grid trend-ind-grid">
              {t.items.filter((x) => x.cls === g.key).map((item) => (
                <IndicatorCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </details>
    </section>
  )
}

export default function Trend({ coins, coinsStatus, onRefreshCoins }) {
  const { sources, updatedAt, reload } = useMacro()
  const waitSeconds = useRateLimitNotice()
  const perpRows = useMemo(() => buildPerpRows(sources), [sources])
  const trends = useMemo(() => evaluateTrend({ sources, perpRows, coins }), [sources, perpRows, coins])
  const anyLoading = coinsStatus === 'loading' || Object.values(sources).some((x) => x.status === 'loading')
  const [open, setOpen] = useState(loadIndicatorOpen)

  function toggleIndicators(key, value) {
    setOpen((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(INDICATORS_KEY, JSON.stringify(next))
      } catch {
        // storage full or unavailable
      }
      return next
    })
  }

  return (
    <section className="macro trend">
      <div className="page-header">
        <div>
          <h1>Trend</h1>
          <p className="updated">
            {anyLoading ? 'Loading snapshot data…' : `Snapshot loaded ${formatUpdatedAt(updatedAt)}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={anyLoading}
          onClick={() => {
            reload()
            onRefreshCoins?.()
          }}
        >
          {anyLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {waitSeconds != null && (
        <div className="banner banner-info" role="status">
          CoinGecko is rate-limiting; retrying in {waitSeconds}s.
        </div>
      )}

      {trends.map((t) => (
        <TrendCard
          key={t.key}
          t={t}
          loadingPrices={coinsStatus === 'loading'}
          indicatorsOpen={open[t.key]}
          onToggleIndicators={(v) => toggleIndicators(t.key, v)}
        />
      ))}

      <p className="fine-print trend-foot">
        Probabilities are heuristic, not backtested, and floored at 10% so they never show certainty. Direction uses BTC and
        the median top-100 coin against Deribit-implied σ; Macro&apos;s data is reused, no price history is pulled. Not advice.
      </p>
    </section>
  )
}
