// Vercel Node serverless function: Binance USDⓈ-M futures PUBLIC market data.
//
// Why this exists: browser calls to fapi.binance.com fail from some regions
// (HTTP 451 "restricted location"), so the Macro tab fetches Binance through
// this function, which is pinned to a Vercel region Binance serves (see
// vercel.json "regions").
//
// Safety:
//   - public, keyless market-data endpoints only (no API key, no account or
//     trading endpoints);
//   - NOT an open proxy: the request URL/query is ignored, symbols and
//     endpoints come from the fixed whitelist below;
//   - responses are CDN-cached (s-maxage=60) so Binance sees at most ~1 burst
//     of requests per minute per region, regardless of visitor count.
//
// Upstream requests per cache miss: 2 + 5 × 10 coins = 52 (weight well under
// Binance's 2400/min IP limit and the 1000 / 5 min /futures/data limit).

const BASE = 'https://fapi.binance.com'
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'XMR', 'ZEC']
const H = 3_600_000

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class UpstreamError extends Error {
  constructor(status, path) {
    super(`HTTP ${status} ${path.split('?')[0]}`)
    this.status = status
  }
}

// GET a whitelisted path with up to two retries on transient errors (CloudFront 403
// bursts, 429, 5xx). 451 = region-blocked: no point retrying.
async function get(path, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { Accept: 'application/json', 'User-Agent': 'coinpricer-macro/1.0 (public market data)' },
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) return await res.json()
      last = new UpstreamError(res.status, path)
      if (res.status === 451 || res.status === 418) throw last // blocked / IP-banned
    } catch (e) {
      if (e instanceof UpstreamError && (e.status === 451 || e.status === 418)) throw e
      last = e
    }
    if (i < tries - 1) await sleep(400 * (i + 1) + Math.random() * 400)
  }
  throw last
}

// Run async jobs with limited concurrency (be polite to the WAF).
async function pool(jobs, n = 8) {
  const out = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++
        try {
          out[i] = { ok: true, v: await jobs[i]() }
        } catch (e) {
          out[i] = { ok: false, e }
        }
      }
    }),
  )
  return out
}

export async function collect() {
  const startedAt = Date.now()
  const errors = []
  const [pi, fi] = await pool([() => get('/fapi/v1/premiumIndex'), () => get('/fapi/v1/fundingInfo')], 2)
  if (!pi.ok) throw pi.e
  if (!fi.ok) errors.push(`fundingInfo: ${fi.e?.message}`)
  const prem = new Map((Array.isArray(pi.v) ? pi.v : []).map((r) => [r.symbol, r]))
  const interval = new Map((fi.ok && Array.isArray(fi.v) ? fi.v : []).map((r) => [r.symbol, num(r.fundingIntervalHours)]))
  const listed = COINS.filter((c) => prem.has(`${c}USDT`))

  const PER = 5
  const jobs = listed.flatMap((c) => {
    const s = `${c}USDT`
    return [
      () => get(`/fapi/v1/openInterest?symbol=${s}`),
      () => get(`/futures/data/openInterestHist?symbol=${s}&period=1h&limit=25`),
      () => get(`/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=25`),
      () => get(`/futures/data/topLongShortPositionRatio?symbol=${s}&period=1h&limit=1`),
      () => get(`/futures/data/takerlongshortRatio?symbol=${s}&period=1h&limit=24`),
    ]
  })
  const res = await pool(jobs, 8)

  const coins = {}
  listed.forEach((c, ci) => {
    const s = `${c}USDT`
    const p = prem.get(s)
    const r = res.slice(ci * PER, ci * PER + PER)
    r.forEach((x, k) => {
      if (!x.ok) errors.push(`${c} ${['openInterest', 'openInterestHist', 'globalLongShortAccountRatio', 'topLongShortPositionRatio', 'takerlongshortRatio'][k]}: ${x.e?.message}`)
    })
    const [oi, oiHist, gls, top, taker] = r.map((x) => (x.ok && Array.isArray(x.v) ? x.v : x.ok ? x.v : null))

    const mark = num(p.markPrice)
    const index = num(p.indexPrice)
    const intervalH = interval.get(s) || 8
    const rate = num(p.lastFundingRate)
    const oiCoin = num(oi?.openInterest)

    const hist = (Array.isArray(oiHist) ? oiHist : [])
      .map((h) => ({ t: num(h.timestamp), usd: num(h.sumOpenInterestValue) }))
      .filter((h) => h.t && h.usd)
      .sort((a, b) => a.t - b.t)
    const hFirst = hist[0]
    const hLast = hist[hist.length - 1]

    const ls = (Array.isArray(gls) ? gls : [])
      .map((h) => ({ t: num(h.timestamp), r: num(h.longShortRatio), long: num(h.longAccount) }))
      .filter((h) => h.t && h.r != null)
      .sort((a, b) => a.t - b.t)
    const lsNow = ls[ls.length - 1]
    const lsThen = ls[0]

    const tk = Array.isArray(taker) ? taker : []
    const buy = tk.reduce((a, h) => a + (num(h.buyVol) ?? 0), 0)
    const sell = tk.reduce((a, h) => a + (num(h.sellVol) ?? 0), 0)
    const topNow = Array.isArray(top) ? top[top.length - 1] : null

    coins[c] = {
      symbol: s,
      mark,
      index,
      premium: mark && index ? mark / index - 1 : null,
      fundingRate: rate,
      intervalH,
      funding8h: rate == null ? null : (rate * 8) / intervalH,
      nextFundingTime: num(p.nextFundingTime),
      oiCoin,
      oiUsd: oiCoin != null && mark ? oiCoin * mark : null,
      oiChange24hPct: hFirst && hLast && hLast.t > hFirst.t ? (hLast.usd / hFirst.usd - 1) * 100 : null,
      oiHours: hFirst && hLast ? (hLast.t - hFirst.t) / H : null,
      accountLsr: lsNow?.r ?? null,
      accountLsrThen: lsThen && lsNow && lsNow.t > lsThen.t ? lsThen.r : null,
      longAccountPct: lsNow?.long != null ? lsNow.long * 100 : null,
      topPositionLsr: num(topNow?.longShortRatio),
      takerRatio: sell ? buy / sell : null,
      takerHours: tk.length,
    }
  })

  return {
    source: 'binance-usdm',
    region: process.env.VERCEL_REGION || 'local',
    fetchedAt: Date.now(),
    ms: Date.now() - startedAt,
    requests: 2 + jobs.length,
    coins,
    unlisted: COINS.filter((c) => !listed.includes(c)),
    errors,
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  try {
    const body = await collect()
    res.statusCode = 200
    // Browser: always revalidate. CDN: share one upstream fetch per minute.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120')
    res.end(JSON.stringify(body))
  } catch (e) {
    const blocked = e?.status === 451 || e?.status === 403 || e?.status === 418
    res.statusCode = 502
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20')
    res.end(
      JSON.stringify({
        error: blocked ? 'Binance blocked this server region' : 'Binance unavailable',
        upstreamStatus: e?.status ?? null,
        detail: e?.message ?? String(e),
        region: process.env.VERCEL_REGION || 'local',
      }),
    )
  }
}
