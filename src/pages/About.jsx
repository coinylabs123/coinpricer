export default function About() {
  return (
    <section className="about">
      <h1>About CoinPricer</h1>
      <p>
        CoinPricer Beta is a lightweight personal dashboard for checking the latest
        cryptocurrency prices. Each time you open or refresh the page, it loads the
        top 100 coins by market cap — once. There are no background jobs, no
        accounts, and no servers of our own holding your data.
      </p>
      <p>
        Star coins to build a watchlist. It stays in this browser&apos;s local storage
        so it is still here the next time you visit. To take the same list to another
        browser or device, use <strong>Copy sync link</strong> or export a small JSON
        file and import it there.
      </p>
      <p>
        You can show prices in USD (default) or SGD, plus a couple of other major
        currencies. Your choice is remembered locally alongside the watchlist.
      </p>
      <p className="credit">
        Data from <a href="https://www.coingecko.com" target="_blank" rel="noreferrer">CoinGecko</a>.
        This project is not affiliated with CoinGecko.
      </p>
    </section>
  )
}
