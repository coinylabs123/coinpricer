// Build a two-column Name / Price table for pasting into Excel.
// Prices are raw decimal strings (no currency symbol, grouping, or compact suffixes).

const HEADER = ['Name', 'Price']

export function rawPrice(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (n === 0) return '0'
  const abs = Math.abs(n)
  // Prefer a plain decimal so Excel treats the cell as a number, including micro prices.
  if (abs >= 1e-12 && abs < 1e15) {
    return n.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 })
  }
  return String(n)
}

function tsvField(value) {
  const s = value == null ? '' : String(value)
  if (/[\t\n\r"]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function tableRows(coins) {
  return (coins ?? []).map((c) => [c?.name ?? '', rawPrice(c?.current_price)])
}

export function buildExcelTsv(coins) {
  const rows = [HEADER, ...tableRows(coins)]
  return rows.map((row) => row.map(tsvField).join('\t')).join('\r\n')
}

export function buildExcelHtml(coins) {
  const body = tableRows(coins)
    .map(
      ([name, price]) =>
        `<tr><td>${htmlEscape(name)}</td><td>${htmlEscape(price)}</td></tr>`,
    )
    .join('')
  return `<table><thead><tr><th>Name</th><th>Price</th></tr></thead><tbody>${body}</tbody></table>`
}

async function copyWithTextarea(text) {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  el.style.top = '0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('Copy command failed')
}

export async function copyExcelTable(coins) {
  const tsv = buildExcelTsv(coins)
  const html = buildExcelHtml(coins)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      return tsv
    } catch {
      // fall through to plain-text copy
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(tsv)
      return tsv
    } catch {
      // fall through
    }
  }
  await copyWithTextarea(tsv)
  return tsv
}
