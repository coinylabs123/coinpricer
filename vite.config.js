import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev only: serve /api/binance from the same handler Vercel runs in
// production (api/binance.js), with a 60 s in-memory cache like the CDN.
function localApi() {
  let cache = null
  return {
    name: 'local-api-binance',
    configureServer(server) {
      server.middlewares.use('/api/binance', async (req, res) => {
        if (cache && Date.now() - cache.t < 60_000) {
          res.statusCode = cache.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(cache.body)
          return
        }
        const { default: handler } = await server.ssrLoadModule('/api/binance.js')
        const shim = {
          statusCode: 200,
          setHeader: (k, v) => res.setHeader(k, v),
          end: (b) => {
            if (shim.statusCode === 200) cache = { t: Date.now(), status: 200, body: b }
            // Like the CDN's stale-while-revalidate: on an upstream error keep serving the last good copy.
            const out = shim.statusCode !== 200 && cache ? cache : { status: shim.statusCode, body: b }
            res.statusCode = out.status
            res.end(out.body)
          },
        }
        await handler(req, shim)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
})
