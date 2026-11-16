export default function ImportDialog({ payload, currentCount, onMerge, onReplace, onCancel }) {
  if (!payload) return null

  const count = payload.watchlist.length
  const source = payload.source === 'link' ? 'this sync link' : 'this file'
  const currencyNote = payload.currency
    ? payload.currency.toUpperCase()
    : null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="import-title">Import watchlist</h2>
        <p>
          {source === 'this sync link' ? 'This sync link' : 'This file'} includes{' '}
          <strong>
            {count} coin{count === 1 ? '' : 's'}
          </strong>
          {currencyNote ? (
            <>
              {' '}
              and currency <strong>{currencyNote}</strong>
            </>
          ) : null}
          . You currently have {currentCount} saved
          {currentCount === 1 ? ' coin' : ' coins'}.
        </p>
        <ul className="import-ids">
          {payload.watchlist.slice(0, 12).map((id) => (
            <li key={id}>{id}</li>
          ))}
          {count > 12 ? <li>…and {count - 12} more</li> : null}
        </ul>
        <p className="modal-hint">
          <strong>Merge</strong> adds any new coins and keeps your current currency.{' '}
          <strong>Replace</strong> overwrites your watchlist
          {currencyNote ? ' and applies the imported currency' : ''}.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onMerge}>
            Merge
          </button>
          <button type="button" className="btn btn-danger-outline" onClick={onReplace}>
            Replace
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
