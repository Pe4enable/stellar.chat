import type { Quote } from "../types";

const TIER_COPY: Record<string, string> = {
  lite: "Efficient models. A quick pass.",
  advanced: "Full analysis, with proof-of-concept checks.",
  pro: "The strongest models, for a release you cannot afford to get wrong.",
};

type Props = {
  quotes: Quote[];
  busy: boolean;
  onStart: (quote: Quote) => void;
  onBack: () => void;
};

export function QuoteScreen({ quotes, busy, onStart, onBack }: Props) {
  const ordered = quotes.slice().sort((a, b) => rank(a.tier) - rank(b.tier));

  return (
    <section className="quote-panel">
      <p className="kicker">Savant</p>
      <h2>Choose an audit</h2>
      <p className="lead">
        Nothing is reserved until you start. A typical run takes 10–15 minutes, and Savant keeps going if you close
        the tab.
      </p>
      <div className="quote-list">
        {ordered.map((quote) => (
          <button
            key={quote.tier}
            className="quote"
            type="button"
            disabled={busy}
            onClick={() => onStart(quote)}
          >
            <span className="quote-top">
              <span className="quote-tier">{quote.tier}</span>
              <span className="quote-cost">${quote.estimatedCost}</span>
            </span>
            <span className="quote-copy">{TIER_COPY[quote.tier] ?? "Savant audit tier."}</span>
            <span className="quote-meta">
              {quote.fileCount} {quote.fileCount === 1 ? "file" : "files"}
              {quote.tokenCount ? ` · ${quote.tokenCount.toLocaleString()} tokens` : ""}
              {quote.discountPercent > 0 && quote.standardCost ? ` · was $${quote.standardCost}` : ""}
              {quote.balanceAfter ? ` · balance after $${quote.balanceAfter}` : ""}
            </span>
          </button>
        ))}
      </div>
      <button className="btn ghost" type="button" onClick={onBack} disabled={busy}>
        Back to code
      </button>
    </section>
  );
}

function rank(tier: string): number {
  const index = ["lite", "advanced", "pro"].indexOf(tier);
  return index === -1 ? 99 : index;
}
