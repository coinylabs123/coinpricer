# CoinPricer Beta

A personal cryptocurrency price dashboard. Each time you open the page it fetches the latest top-100 market data from CoinGecko’s free API — once. There is no background polling and no account system.

Your watchlist and currency preference are stored in this browser (`localStorage`). To use the same list in another browser, copy a sync link or export a JSON file.

This is a recreation of the idea behind [coinpricer.cc](https://coinpricer.cc), built as a static React app for personal use.

## Features

- Dashboard table: rank, icon, name/symbol, price, 24h change, market cap, 24h volume
- Sortable columns and a navbar search filter
- Star coins to save a watchlist (including coins outside the top 100)
- Currency selector: USD (default), SGD, EUR, GBP — remembered locally
- Manual **Refresh** button, last-updated time, loading and error states (including a friendly message when CoinGecko returns HTTP 429)
- **Copy sync link** — encodes your watchlist coin ids and currency into a URL hash (`#w=bitcoin,ethereum&c=sgd`). Opening that link on another browser offers Merge or Replace, then cleans the URL
- **Export watchlist** / **Import** — download or load a small JSON file, with the same merge-or-replace choice
- About page, with credit: Data from CoinGecko

## Run locally

You need Node.js 18+ (20 or 22 is fine).

```bash
cd coinpricer
npm install
npm run dev
```

Then open the URL Vite prints (default `http://127.0.0.1:5173/`).

To build the production bundle and preview it:

```bash
npm run build
npm run preview
```

The preview server defaults to `http://127.0.0.1:4173/`.

## Deploy (static hosting)

`npm run build` writes a static site to `dist/`. Upload that folder to any static host.

- **Netlify** — drag-and-drop `dist/`, or connect the repo. `public/_redirects` already rewrites all paths to `index.html` so `/about` works.
- **Cloudflare Pages** — same `_redirects` file is supported. Build command: `npm run build`. Output directory: `dist`.
- **Vercel** — `vercel.json` already rewrites routes to `index.html`. Framework preset can be Vite; output is `dist`.

No environment variables or backend are required. The browser calls CoinGecko directly.

After deploying, sync links look like:

```
https://your-domain.example/#w=bitcoin,ethereum&c=sgd
```

## Watchlist file format

Exported files look like this:

```json
{
  "version": 1,
  "app": "coinpricer",
  "exportedAt": "2026-11-16T09:00:00.000Z",
  "currency": "sgd",
  "watchlist": ["bitcoin", "ethereum"]
}
```

Coin ids must be CoinGecko ids (lowercase, digits, and hyphens).

## Caveats

- CoinGecko’s free public API is rate limited. Loading the page usually makes one request (top 100). A second request is made only if your watchlist includes coins outside that list. Changing currency or clicking Refresh fetches again. If you see a 429 error, wait a minute and retry.
- The watchlist never leaves your browser unless you copy a sync link or export a file. A sync link is not a secret — anyone who opens it can import those coin ids.
- Coin icons are loaded from CoinGecko’s image CDN.
