import type { Quote } from "../types";

type Props = {
  quotes: Quote[];
  busy: boolean;
  onStart: (quote: Quote) => void;
  onBack: () => void;
};

export function QuoteScreen({ quotes, busy, onStart, onBack }: Props) {
  const quote = quotes.find((item) => item.tier === "advanced") ?? quotes[0];
  if (!quote) return null;

  return (
    <section className="quote-panel">
      <p className="kicker">Savant · advanced</p>
      <h2>Start the audit</h2>
      <p className="lead">
        Savant priced this contract as an advanced audit. Nothing is reserved until you start. A typical run takes
        10–15 minutes, and Savant keeps going if you close the tab.
      </p>
      <div className="quote">
        <span className="quote-top">
          <span className="quote-tier">Advanced</span>
          <span className="quote-cost">${quote.estimatedCost}</span>
        </span>
        <span className="quote-copy">Full analysis, with proof-of-concept checks.</span>
        <span className="quote-meta">
          {quote.fileCount} {quote.fileCount === 1 ? "file" : "files"}
          {quote.tokenCount ? ` · ${quote.tokenCount.toLocaleString()} tokens` : ""}
          {quote.discountPercent > 0 && quote.standardCost ? ` · was $${quote.standardCost}` : ""}
          {quote.balanceAfter ? ` · balance after $${quote.balanceAfter}` : ""}
        </span>
      </div>
      <div className="row">
        <button className="btn primary" type="button" disabled={busy} onClick={() => onStart(quote)}>
          Start advanced · ${quote.estimatedCost}
        </button>
        <button className="btn ghost" type="button" onClick={onBack} disabled={busy}>
          Back to code
        </button>
      </div>
    </section>
  );
}
