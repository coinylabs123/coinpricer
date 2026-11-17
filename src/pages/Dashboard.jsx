import { useMemo, useRef, useState } from 'react'
import CoinTable, { sortCoins } from '../components/CoinTable.jsx'
import { useCoinList } from '../hooks/useCoinList.js'
import { useFullSearch } from '../hooks/useFullSearch.js'
import { formatUpdatedAt } from '../utils/format.js'
import { buildSyncUrl, downloadWatchlistFile, parseWatchlistFile } from '../utils/sync.js'

export default function Dashboard({
  coins,
  status,
  error,
  warning,
  updatedAt,
  onRefresh,
  currency,
  watchlist,
  onToggleWatch,
  query,
  onRequestImport,
}) {
  const [tab, setTab] = useState('all') // all | watchlist
  const [sortKey, setSortKey] = useState('market_cap_rank')
  const [sortDir, setSortDir] = useState('asc')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [toast, setToast] = useState('')
  const fileRef = useRef(null)

  const watchlistSet = useMemo(() => new Set(watchlist), [watchlist])
  const { coins: coinList, status: coinListStatus, error: coinListError } = useCoinList()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tab === 'watchlist' ? coins.filter((c) => watchlistSet.has(c.id)) : coins.filter((c) => c.market_cap_rank && c.market_cap_rank <= 100)

    // Keep watchlist-only coins visible on the All tab too, after the top 100,
    // so a starred off-list coin is not "missing" until you switch tabs.
    if (tab === 'all') {
      const extras = coins.filter(
        (c) => watchlistSet.has(c.id) && !(c.market_cap_rank && c.market_cap_rank <= 100),
      )
      list = [...list, ...extras]
    }

    if (q) {
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.symbol?.toLowerCase().includes(q) ||
          c.id?.toLowerCase().includes(q),
      )
    }
    return sortCoins(list, sortKey, sortDir)
  }, [coins, tab, watchlistSet, query, sortKey, sortDir])

  const excludeIds = useMemo(() => new Set(filtered.map((c) => c.id)), [filtered])
  const searching = Boolean(query.trim())
  const {
    results: moreResults,
    status: moreStatus,
    error: moreError,
    truncated,
  } = useFullSearch({
    query,
    currency,
    excludeIds,
    loadedCoins: coins,
    coinList,
    coinListStatus,
    coinListError,
    enabled: searching,
  })
  const [moreSortKey, setMoreSortKey] = useState(null)
  const [moreSortDir, setMoreSortDir] = useState('asc')
  const moreSorted = useMemo(() => {
    if (!moreResults.length || !moreSortKey) return moreResults
    return sortCoins(moreResults, moreSortKey, moreSortDir)
  }, [moreResults, moreSortKey, moreSortDir])

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'market_cap_rank' ? 'asc' : 'desc')
    }
  }

  function handleMoreSort(key) {
    if (key === moreSortKey) {
      setMoreSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setMoreSortKey(key)
      setMoreSortDir(key === 'name' || key === 'market_cap_rank' ? 'asc' : 'desc')
    }
  }

  async function handleCopySyncLink() {
    setCopyError('')
    const url = buildSyncUrl(watchlist, currency)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        window.prompt('Copy this sync link:', url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        setCopyError('Could not copy. Select and copy this link: ' + url)
      }
    }
  }

  function handleExport() {
    if (!watchlist.length) {
      setToast('Star at least one coin before exporting.')
      setTimeout(() => setToast(''), 2500)
      return
    }
    downloadWatchlistFile(watchlist, currency)
    setToast('Watchlist file downloaded.')
    setTimeout(() => setToast(''), 2500)
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const payload = parseWatchlistFile(text)
      onRequestImport(payload)
    } catch (err) {
      setToast(err.message || 'Could not import that file.')
      setTimeout(() => setToast(''), 4000)
    }
  }

  const loading = status === 'loading'
  const failed = status === 'error'
  const showMoreSection =
    searching &&
    (moreResults.length > 0 ||
      moreStatus === 'loading' ||
      moreStatus === 'error' ||
      moreStatus === 'idle' ||
      (moreStatus === 'success' && filtered.length === 0))
  const showMainTable =
    coins.length > 0 && !(tab === 'watchlist' && watchlist.length === 0) && !failed && filtered.length > 0

  function moreErrorMessage() {
    if (!moreError) return ''
    if (moreError.kind === 'rate_limit') return moreError.message
    if (coinListStatus === 'error' && !moreResults.length) {
      return "Couldn't load the full coin list. You can still search the top 100."
    }
    return "Couldn't load prices for some search results. The rest of the page is unchanged."
  }

  return (
    <section className="dashboard">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="updated">
            {loading && !updatedAt ? 'Loading latest prices…' : null}
            {updatedAt ? (
              <>
                Last updated {formatUpdatedAt(updatedAt)}
                {loading ? ' · Refreshing…' : ''}
              </>
            ) : null}
            {failed && !updatedAt ? 'Prices could not be loaded.' : null}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Coin list">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={tab === 'all' ? 'tab active' : 'tab'}
            onClick={() => setTab('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'watchlist'}
            className={tab === 'watchlist' ? 'tab active' : 'tab'}
            onClick={() => setTab('watchlist')}
          >
            Watchlist
            <span className="tab-count">{watchlist.length}</span>
          </button>
        </div>

        <div className="toolbar-actions">
          <button type="button" className="btn btn-outline" onClick={handleCopySyncLink}>
            {copied ? 'Link copied' : 'Copy sync link'}
          </button>
          <button type="button" className="btn btn-outline" onClick={handleExport}>
            Export watchlist
          </button>
          <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {copyError ? <p className="banner banner-info">{copyError}</p> : null}
      {toast ? <p className="banner banner-info">{toast}</p> : null}
      {warning ? <p className="banner banner-warn">{warning}</p> : null}

      {failed ? (
        <div className="state-card error-card">
          <h2>Could not load prices</h2>
          <p>{error?.message || 'Something went wrong talking to CoinGecko.'}</p>
          <button type="button" className="btn btn-primary" onClick={onRefresh}>
            Retry
          </button>
        </div>
      ) : null}

      {loading && !coins.length ? (
        <div className="state-card" aria-busy="true">
          <div className="spinner" aria-hidden="true" />
          <p>Fetching the latest prices from CoinGecko…</p>
          <div className="skeleton-table" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'watchlist' && !watchlist.length && !failed ? (
        <div className="state-card">
          <h2>Your watchlist is empty</h2>
          <p>Star coins in the table to save them in this browser. You can copy a sync link or export a file to use the same list on another device.</p>
        </div>
      ) : null}

      {tab === 'watchlist' && watchlist.length > 0 && !filtered.length && !loading && !failed ? (
        <p className="empty">None of your watched coins match this search, or their prices have not loaded yet.</p>
      ) : null}

      {tab === 'all' && searching && !filtered.length && !loading && !failed && coins.length > 0 ? (
        <p className="empty">None of the top 100 coins match this search.</p>
      ) : null}

      {showMainTable ? (
        <CoinTable
          coins={filtered}
          currency={currency}
          watchlistSet={watchlistSet}
          onToggleWatch={onToggleWatch}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      ) : null}

      {showMoreSection ? (
        <section className="more-results" aria-live="polite">
          <div className="more-results-header">
            <h2 className="more-results-title">More results from all coins</h2>
            {truncated ? <p className="more-results-meta">Showing the top 50 matches.</p> : null}
          </div>
          {moreStatus === 'idle' || (moreStatus === 'loading' && !moreResults.length) ? (
            <p className="more-results-meta">
              {coinListStatus === 'loading' && !coinList.length
                ? 'Loading the full coin list…'
                : 'Searching all coins…'}
            </p>
          ) : null}
          {moreStatus === 'loading' && moreResults.length ? (
            <p className="more-results-meta">Loading prices…</p>
          ) : null}
          {moreError ? <p className="banner banner-warn">{moreErrorMessage()}</p> : null}
          {moreSorted.length ? (
            <CoinTable
              coins={moreSorted}
              currency={currency}
              watchlistSet={watchlistSet}
              onToggleWatch={onToggleWatch}
              sortKey={moreSortKey}
              sortDir={moreSortDir}
              onSort={handleMoreSort}
            />
          ) : moreStatus === 'success' && !moreError ? (
            <p className="empty">No other coins match this search.</p>
          ) : null}
        </section>
      ) : null}

      <p className="fine-print">
        Prices load once when you open or refresh this page. Nothing is polled in the background.
        Search can look up CoinGecko&apos;s full coin list, which is cached in this browser for 24 hours.
        Watchlist and currency are saved in this browser. Data from CoinGecko.
      </p>
    </section>
  )
}
