// Per-coin perp aggregation & classification. Heuristics, not financial advice.
import { COIN_GECKO_IDS, PERP_COINS, VENUES } from '../api/perps.js'

// Funding bands, in % per 8h (8h-equivalent). +0.01% is the common "neutral"
// baseline (interest component) on most CEX perps.
export const FUNDING_BANDS = { crowdedLong: 0.03, leanLong: 0.015, leanShort: -0.005, crowdedShort: -0.02 }
// OI as % of the coin's market cap, summed over the venues we can see (a subset
// of the whole market — Binance, Bybit and CME are not included).
export const OI_BANDS = { high: 2.0, elevated: 1.0 }

export function positioningFor(f) {
  if (f == null) return { key: 'na', label: '—', side: 0, crowded: false }
  if (f >= FUNDING_BANDS.crowdedLong) return { key: 'crowded-long', label: 'Crowded longs', side: 1, crowded: true }
  if (f >= FUNDING_BANDS.leanLong) return { key: 'lean-long', label: 'Leaning long', side: 1, crowded: false }
  if (f > FUNDING_BANDS.leanShort) return { key: 'neutral', label: 'Neutral', side: 0, crowded: false }
  if (f > FUNDING_BANDS.crowdedShort) return { key: 'lean-short', label: 'Leaning short', side: -1, crowded: false }
  return { key: 'crowded-short', label: 'Crowded shorts', side: -1, crowded: true }
}

export function oiLevelFor(pct) {
  if (pct == null) return { key: 'na', label: '—', pts: 0 }
  if (pct >= OI_BANDS.high) return { key: 'high', label: 'High', pts: 2 }
  if (pct >= OI_BANDS.elevated) return { key: 'elevated', label: 'Elevated', pts: 1 }
  return { key: 'normal', label: 'Normal', pts: 0 }
}

// Squeeze risk: points = crowding (2 crowded / 1 leaning) + OI level (2 high / 1 elevated).
// ≥4 High · 3 Medium · 2 Low · else none. Side follows funding sign.
export function squeezeFor(pos, oi) {
  if (!pos.side) return { key: 'none', label: 'None', level: 0 }
  const pts = (pos.crowded ? 2 : 1) + oi.pts
  const kind = pos.side < 0 ? 'Short-squeeze' : 'Long-flush'
  if (pts >= 4) return { key: 'high', label: `${kind}: High`, level: 3, side: pos.side }
  if (pts >= 3) return { key: 'medium', label: `${kind}: Medium`, level: 2, side: pos.side }
  if (pts >= 2) return { key: 'low', label: `${kind}: Low`, level: 1, side: pos.side }
  return { key: 'none', label: 'None', level: 0 }
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function buildPerpRows(sources) {
  const prices = sources.prices?.data
  const hist = sources.okxHistory?.data
  const venueData = {
    okx: sources.okx?.data,
    hyperliquid: sources.hyperliquid?.data,
    gate: sources.gate?.data,
    bitget: sources.bitget?.data,
    deribit: sources.deribit?.data?.perps,
    dydx: sources.dydx?.data,
  }
  return PERP_COINS.map((coin) => {
    const venues = Object.entries(venueData)
      .map(([k, d]) => (d?.[coin] ? { ...d[coin], venue: k, venueLabel: VENUES[k].label } : null))
      .filter(Boolean)
    const withF = venues.filter((v) => v.funding8h != null)
    const weighted = withF.filter((v) => v.oiUsd)
    const wSum = weighted.reduce((a, v) => a + v.oiUsd, 0)
    const funding8h = wSum
      ? weighted.reduce((a, v) => a + v.funding8h * v.oiUsd, 0) / wSum
      : avg(withF.map((v) => v.funding8h))
    const fundingPct = funding8h == null ? null : funding8h * 100
    const oiVenues = venues.filter((v) => v.oiUsd != null)
    const oiUsd = oiVenues.length ? oiVenues.reduce((a, v) => a + v.oiUsd, 0) : null
    const mcap = Number(prices?.[COIN_GECKO_IDS[coin]]?.usd_market_cap) || null
    const oiPct = oiUsd != null && mcap ? (oiUsd / mcap) * 100 : null
    const prem = avg(venues.filter((v) => v.premium != null).map((v) => v.premium * 100))
    const pred = avg(venues.filter((v) => v.predicted8h != null).map((v) => v.predicted8h * 100))
    const okx = venues.find((v) => v.venue === 'okx')
    const next8h = okx?.nextFundingTime ?? venues.filter((v) => v.intervalH >= 4 && v.nextFundingTime).map((v) => v.nextFundingTime).sort()[0] ?? null
    const pos = positioningFor(fundingPct)
    const oi = oiLevelFor(oiPct)
    return {
      coin,
      venues,
      fundingPct,
      annualizedPct: fundingPct == null ? null : fundingPct * 3 * 365,
      predictedPct: pred,
      okx24hPct: hist?.[coin]?.avg24h != null ? hist[coin].avg24h * 100 : null,
      okx7dPct: hist?.[coin]?.avg7d != null ? hist[coin].avg7d * 100 : null,
      nextFundingTime: next8h,
      oiUsd,
      mcap,
      oiPct,
      premiumPct: prem,
      positioning: pos,
      oiLevel: oi,
      squeeze: squeezeFor(pos, oi),
    }
  })
}
