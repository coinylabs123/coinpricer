export const SEARCH_LIMIT = 25

function scoreMatch(coin, q) {
  const symbol = (coin.symbol || '').toLowerCase()
  const name = (coin.name || '').toLowerCase()
  const id = (coin.id || '').toLowerCase()
  if (symbol === q) return 0
  if (name === q) return 1
  if (id === q) return 2
  if (symbol.startsWith(q)) return 3
  if (name.startsWith(q)) return 4
  if (id.startsWith(q)) return 5
  if (symbol.includes(q)) return 6
  if (name.includes(q)) return 7
  if (id.includes(q)) return 8
  return null
}

export function matchCoinList(list, rawQuery, { excludeIds, limit = SEARCH_LIMIT } = {}) {
  const q = (rawQuery || '').trim().toLowerCase()
  if (!q || !Array.isArray(list) || !list.length) return []
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || [])
  const scored = []
  for (const coin of list) {
    if (!coin?.id || exclude.has(coin.id)) continue
    const score = scoreMatch(coin, q)
    if (score == null) continue
    scored.push({
      coin,
      score,
      symbol: (coin.symbol || '').toLowerCase(),
      name: (coin.name || '').toLowerCase(),
    })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.symbol.length !== b.symbol.length) return a.symbol.length - b.symbol.length
    const nameCmp = a.name.localeCompare(b.name)
    if (nameCmp) return nameCmp
    return a.coin.id.localeCompare(b.coin.id)
  })
  return scored.slice(0, limit).map((row) => row.coin)
}

export function placeholderMarket(coin) {
  return {
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image: null,
    current_price: null,
    market_cap: null,
    total_volume: null,
    market_cap_rank: null,
    price_change_percentage_24h: null,
    price_change_percentage_24h_in_currency: null,
  }
}
