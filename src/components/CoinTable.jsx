import { formatCompact, formatPercent, formatPrice, percentClass } from '../utils/format.js'

const COLUMNS = [
  { key: 'watched', label: '', sort: false, className: 'col-star' },
  { key: 'market_cap_rank', label: '#', sort: true, className: 'col-rank' },
  { key: 'name', label: 'Name', sort: true, className: 'col-name' },
  { key: 'current_price', label: 'Price', sort: true, className: 'col-price' },
  { key: 'price_change_percentage_24h_in_currency', label: '24h %', sort: true, className: 'col-change' },
  { key: 'market_cap', label: 'Market cap', sort: true, className: 'col-mcap' },
  { key: 'total_volume', label: 'Volume (24h)', sort: true, className: 'col-volume' },
]

function sortValue(coin, key) {
  if (key === 'name') return (coin.name || '').toLowerCase()
  if (key === 'price_change_percentage_24h_in_currency') {
    return coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h ?? null
  }
  const value = coin[key]
  return value == null ? null : value
}

export function sortCoins(coins, sortKey, sortDir) {
  const copy = [...coins]
  copy.sort((a, b) => {
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    const aMissing = av == null || av === ''
    const bMissing = bv == null || bv === ''
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    let cmp = 0
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
    } else {
      cmp = av === bv ? 0 : av < bv ? -1 : 1
    }
    return sortDir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortButton({ column, sortKey, sortDir, onSort }) {
  if (!column.sort) {
    return <span className={column.className}>{column.label}</span>
  }
  const active = sortKey === column.key
  const label = active ? `${column.label}, sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}` : `Sort by ${column.label}`
  return (
    <button
      type="button"
      className={`th-btn ${column.className}${active ? ' sorted' : ''}`}
      onClick={() => onSort(column.key)}
      aria-label={label}
    >
      {column.label}
      <span className="sort-icon" aria-hidden="true">
        {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  )
}

export default function CoinTable({
  coins,
  currency,
  watchlistSet,
  onToggleWatch,
  sortKey,
  sortDir,
  onSort,
}) {
  if (!coins.length) {
    return <p className="empty">No coins match this filter.</p>
  }

  return (
    <div className="table-wrap">
      <table className="coin-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col" className={column.className}>
                <SortButton
                  column={column}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coins.map((coin) => {
            const change =
              coin.price_change_percentage_24h_in_currency ??
              coin.price_change_percentage_24h
            const watched = watchlistSet.has(coin.id)
            return (
              <tr key={coin.id} className={watched ? 'is-watched' : undefined}>
                <td className="col-star">
                  <button
                    type="button"
                    className={watched ? 'star-btn on' : 'star-btn'}
                    onClick={() => onToggleWatch(coin.id)}
                    aria-pressed={watched}
                    aria-label={
                      watched
                        ? `Remove ${coin.name} from watchlist`
                        : `Add ${coin.name} to watchlist`
                    }
                    title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {watched ? '★' : '☆'}
                  </button>
                </td>
                <td className="col-rank">{coin.market_cap_rank ?? '—'}</td>
                <td className="col-name">
                  <span className="coin-id">
                    {coin.image ? (
                      <img src={coin.image} alt="" width="22" height="22" />
                    ) : (
                      <span className="coin-icon-fallback" />
                    )}
                    <span className="coin-text">
                      <span className="coin-name">{coin.name}</span>
                      <span className="coin-symbol">{coin.symbol}</span>
                    </span>
                  </span>
                </td>
                <td className="col-price num">{formatPrice(coin.current_price, currency)}</td>
                <td className={`col-change num ${percentClass(change)}`}>
                  {formatPercent(change)}
                </td>
                <td className="col-mcap num">{formatCompact(coin.market_cap, currency)}</td>
                <td className="col-volume num">{formatCompact(coin.total_volume, currency)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
