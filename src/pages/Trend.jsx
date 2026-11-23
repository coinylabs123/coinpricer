import { useMemo } from 'react'
import { useMacro } from '../hooks/useMacro.js'
import { useRateLimitNotice } from '../hooks/useRateLimitNotice.js'
import { buildPerpRows } from '../utils/perpsAnalysis.js'
import { evaluateTrend } from '../utils/trendAnalysis.js'
import { formatUpdatedAt } from '../utils/format.js'

const spct = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`)
const pctInt = (p) => `${Math.round(p * 100)}%`

function itemState(item) {
  const name = item.cls === 'C' ? 'continuation' : item.cls === 'R' ? 'reversal' : 'ranging'
  if (item.v == null) return { key: 'na', label: 'No data', name }
  if (item.v >= 0.6) return { key: 'supports', label: `Supports ${name}`, name }
  if (item.v >= 0.3) return { key: 'lean', label: `Lean ${name}`, name }
  return { key: 'neutral', label: 'Neutral', name }
}

function panelZone(t) {
  if (t.status !== 'success') return 'neutral'
  const { dir } = t
  if (dir.strengthLabel === 'no clear trend') return 'neutral'
  const strong = dir.strengthLabel === 'strong'
  if (dir.u > 0) return strong ? 'bull' : 'lean-bull'
  return strong ? 'bear' : 'lean-bear'
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

function HorizonPanel({ t, loading }) {
  if (t.status !== 'success') {
    return (
      <div className="bias-panel zone-neutral">
        <div className="bias-head">
          <div>
            <h2>{t.title}</h2>
            <p className="bias-span">{t.span}</p>
          </div>
        </div>
        <p className="macro-value muted">{loading ? 'Loading…' : 'Price snapshot unavailable'}</p>
      </div>
    )
  }
  const { dir } = t
  const up = dir.u > 0
  const flat = dir.strengthLabel === 'no clear trend'
  const arrow = up ? '▲' : '▼'
  const rev = up ? '▼' : '▲'
  const pillKey = flat ? 'neutral' : up ? (dir.strengthLabel === 'strong' ? 'bull' : 'lean-bull') : (dir.strengthLabel === 'strong' ? 'bear' : 'lean-bear')
  const pillLabel = flat ? 'No clear trend' : up ? 'Uptrend' : 'Downtrend'
  return (
    <div className={`bias-panel zone-${panelZone(t)}`}>
      <div className="bias-head">
        <div>
          <h2>{t.title}</h2>
          <p className="bias-span">
            {t.span}
            {!flat && ` · ${dir.strengthLabel}`}
            {flat && ` · leaning ${arrow}`}
          </p>
        </div>
        <div className="bias-call">
          <span className={`zone-pill zone-pill-${pillKey} bias-pill`}>{pillLabel}</span>
        </div>
      </div>

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
        <Bar name="Continuation" arrow={arrow} p={t.probs.continuation} top={t.top === 'continuation'} kind="cont" />
        <Bar name="Reversal" arrow={`→ ${rev}`} p={t.probs.reversal} top={t.top === 'reversal'} kind="rev" />
        <Bar name="Ranging" p={t.probs.ranging} top={t.top === 'ranging'} kind="range" />
      </div>

      <p className="trend-drivers">
        {t.drivers.length ? (
          <>
            <strong>Drivers:</strong> {t.drivers.map((d) => d.label).join(' · ')}
          </>
        ) : (
          <span className="muted">No single driver stands out</span>
        )}
      </p>
      <p className="bias-meta">
        Confidence <strong>{t.confidence}</strong> · coverage {Math.round(t.coverage * 100)}%
        {dir.ivFallback ? ' · DVOL unavailable (60 assumed)' : ''}
      </p>
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

export default function Trend({ coins, coinsStatus, onRefreshCoins }) {
  const { sources, updatedAt, reload } = useMacro()
  const waitSeconds = useRateLimitNotice()
  const perpRows = useMemo(() => buildPerpRows(sources), [sources])
  const trends = useMemo(() => evaluateTrend({ sources, perpRows, coins }), [sources, perpRows, coins])
  const anyLoading = coinsStatus === 'loading' || Object.values(sources).some((x) => x.status === 'loading')

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

      <div className="bias-grid">
        {trends.map((t) => (
          <HorizonPanel key={t.key} t={t} loading={coinsStatus === 'loading'} />
        ))}
      </div>

      {trends.map((t) =>
        t.status === 'success' ? (
          <div key={t.key}>
            <h2 className="section-title">
              {t.title} signals <span className="section-sub">{t.span}</span>
            </h2>
            <div className="macro-grid">
              {t.items.map((item) => (
                <IndicatorCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        ) : null,
      )}

      <p className="fine-print trend-foot">
        Probabilities are heuristic, not backtested, and floored at 10% so they never show certainty. Direction uses BTC and
        the median top-100 coin against Deribit-implied σ; Macro&apos;s data is reused, no price history is pulled. Not advice.
      </p>
    </section>
  )
}
