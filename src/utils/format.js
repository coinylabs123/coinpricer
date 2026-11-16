const COMPACT = new Set(['usd', 'sgd', 'eur', 'gbp', 'aud', 'cad', 'jpy'])

export function formatPrice(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const abs = Math.abs(value)
  let maxFrac = 2
  if (abs > 0 && abs < 0.0001) maxFrac = 8
  else if (abs < 0.01) maxFrac = 6
  else if (abs < 1) maxFrac = 4
  else if (abs < 100) maxFrac = 2
  else maxFrac = 2

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: maxFrac >= 2 ? 2 : maxFrac,
      maximumFractionDigits: maxFrac,
    }).format(value)
  } catch {
    return `${Number(value).toFixed(maxFrac)} ${currency.toUpperCase()}`
  }
}

export function formatCompact(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const cur = currency.toLowerCase()
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur.toUpperCase(),
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    if (!COMPACT.has(cur)) return String(value)
    return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${cur.toUpperCase()}`
  }
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatUpdatedAt(date) {
  if (!date) return ''
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

export function percentClass(value) {
  if (value == null || Number.isNaN(Number(value)) || value === 0) return 'change-flat'
  return value > 0 ? 'change-up' : 'change-down'
}
