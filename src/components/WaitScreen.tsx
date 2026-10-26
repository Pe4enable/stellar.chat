import { useEffect, useState } from "react";
import { endpointLabel, formatElapsed } from "../format";

const WINDOW_MS = 15 * 60 * 1000;

type Props = {
  startedAt: number;
  filename: string;
  lines: number;
  endpoint: string;
  onCancel: () => void;
};

export function WaitScreen({ startedAt, filename, lines, endpoint, onCancel }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const ratio = Math.min(100, (elapsed / WINDOW_MS) * 100);
  const minutes = Math.floor(elapsed / 60000);

  return (
    <section className="center-panel" aria-live="polite">
      <div className="orbit" aria-hidden="true">
        <div className="orbit-spin">
          <span />
        </div>
      </div>
      <p className="kicker">Audit in progress</p>
      <p className="clock">{formatElapsed(elapsed)}</p>
      <p className="lead">
        This usually takes 10–15 minutes. Keep this tab open — closing it stops the request.
      </p>
      <p className="meta">
        {filename} · {lines} {lines === 1 ? "line" : "lines"} · {endpointLabel(endpoint)}
      </p>
      <div className="timebar" aria-hidden="true">
        <span style={{ width: `${ratio}%` }} />
      </div>
      <p className="hint">
        {ratio >= 100
          ? "Past the usual 15-minute window. Still waiting on the service."
          : "The bar marks the usual 15-minute window, not how finished the audit is."}
      </p>
      <p className="sr-only">Elapsed time: {minutes} minutes.</p>
      <button className="btn ghost" type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
