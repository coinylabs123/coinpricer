import { useCallback, useEffect, useState } from 'react'
import Navbar from './components/Navbar.jsx'
import ImportDialog from './components/ImportDialog.jsx'
import Dashboard from './pages/Dashboard.jsx'
import About from './pages/About.jsx'
import Macro from './pages/Macro.jsx'
import Trend from './pages/Trend.jsx'
import { useCoins } from './hooks/useCoins.js'
import { useCurrency } from './hooks/useCurrency.js'
import { useWatchlist } from './hooks/useWatchlist.js'
import { cleanSyncFromUrl, parseSyncPayloadFromLocation } from './utils/sync.js'

function viewFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/about') return 'about'
  if (path === '/macro') return 'macro'
  if (path === '/trend') return 'trend'
  return 'dashboard'
}

export default function App() {
  const [view, setView] = useState(() => viewFromPath())
  const [query, setQuery] = useState('')
  const [importPayload, setImportPayload] = useState(null)

  const { currency, setCurrency } = useCurrency()
  const { watchlist, toggle, merge, replace } = useWatchlist()
  const { coins, status, error, warning, updatedAt, reload } = useCoins(currency, watchlist)

  const navigate = useCallback((next) => {
    const path = next === 'about' ? '/about' : next === 'macro' ? '/macro' : next === 'trend' ? '/trend' : '/'
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setView(next)
    if (next !== 'dashboard') setQuery('')
  }, [])

  useEffect(() => {
    const onPop = () => setView(viewFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const payload = parseSyncPayloadFromLocation()
    if (!payload) return
    setImportPayload(payload)
    if (viewFromPath() !== 'dashboard') {
      window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`)
      setView('dashboard')
    }
  }, [])

  function closeImport(apply) {
    if (apply === 'merge') {
      merge(importPayload.watchlist)
    } else if (apply === 'replace') {
      replace(importPayload.watchlist)
      if (importPayload.currency) setCurrency(importPayload.currency)
    }
    setImportPayload(null)
    cleanSyncFromUrl()
  }

  return (
    <div className="app">
      <Navbar
        view={view}
        onNavigate={navigate}
        query={query}
        onQueryChange={setQuery}
        currency={currency}
        onCurrencyChange={setCurrency}
      />
      <main className={view === 'macro' || view === 'trend' ? 'container container-wide' : 'container'}>
        {view === 'dashboard' ? (
          <Dashboard
            coins={coins}
            status={status}
            error={error}
            warning={warning}
            updatedAt={updatedAt}
            onRefresh={reload}
            currency={currency}
            watchlist={watchlist}
            onToggleWatch={toggle}
            query={query}
            onRequestImport={setImportPayload}
          />
        ) : view === 'macro' ? (
          <Macro />
        ) : view === 'trend' ? (
          <Trend coins={coins} coinsStatus={status} onRefreshCoins={reload} />
        ) : (
          <About />
        )}
      </main>
      <ImportDialog
        payload={importPayload}
        currentCount={watchlist.length}
        onMerge={() => closeImport('merge')}
        onReplace={() => closeImport('replace')}
        onCancel={() => closeImport('cancel')}
      />
    </div>
  )
}
