import { SUPPORTED_CURRENCIES } from '../utils/storage.js'

export default function Navbar({
  view,
  onNavigate,
  query,
  onQueryChange,
  currency,
  onCurrencyChange,
}) {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault()
            onNavigate('dashboard')
          }}
        >
          <span className="brand-mark" aria-hidden="true">₵</span>
          CoinPricer <span className="brand-beta">Beta</span>
        </a>

        <nav className="nav-links" aria-label="Main">
          <button
            type="button"
            className={view === 'dashboard' ? 'nav-link active' : 'nav-link'}
            onClick={() => onNavigate('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={view === 'macro' ? 'nav-link active' : 'nav-link'}
            onClick={() => onNavigate('macro')}
          >
            Macro
          </button>
          <button
            type="button"
            className={view === 'about' ? 'nav-link active' : 'nav-link'}
            onClick={() => onNavigate('about')}
          >
            About
          </button>
        </nav>

        {view === 'dashboard' ? (
          <form
            className="nav-search"
            role="search"
            onSubmit={(e) => e.preventDefault()}
          >
            <label htmlFor="coin-search" className="sr-only">
              Search coins
            </label>
            <input
              id="coin-search"
              type="search"
              placeholder="Search all coins"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoComplete="off"
            />
          </form>
        ) : (
          <div className="nav-search-spacer" />
        )}

        <label className="currency-select">
          <span className="sr-only">Display currency</span>
          <select
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
            aria-label="Display currency"
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  )
}
