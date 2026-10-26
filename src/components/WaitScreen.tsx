import { useEffect, useState } from "react";
import { formatElapsed } from "../format";

const WINDOW_MS = 15 * 60 * 1000;

type Props = {
  startedAt: number;
  filename: string;
  lines: number;
  note: string;
  kicker?: string;
  showWindow?: boolean;
  stage?: string;
  progress?: number | null;
  cancelLabel: string;
  onCancel: () => void;
};

export function WaitScreen({
  startedAt,
  filename,
  lines,
  note,
  kicker = "Audit in progress",
  showWindow = true,
  stage,
  progress,
  cancelLabel,
  onCancel,
}: Props) {
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
      <p className="kicker">{kicker}</p>
      <p className="clock">{formatElapsed(elapsed)}</p>
      <p className="lead">{note}</p>
      <p className="meta">
        {filename} · {lines} {lines === 1 ? "line" : "lines"}
        {stage ? ` · ${stage}` : ""}
        {progressLabel(progress)}
      </p>
      {showWindow ? (
        <>
          <div className="timebar" aria-hidden="true">
            <span style={{ width: `${ratio}%` }} />
          </div>
          <p className="hint">
            {ratio >= 100
              ? "Past the usual 15-minute window. Still waiting on Savant."
              : "The bar marks the usual 15-minute window, not how finished the audit is."}
          </p>
        </>
      ) : null}
      <p className="sr-only">Elapsed time: {minutes} minutes.</p>
      <button className="btn ghost" type="button" onClick={onCancel}>
        {cancelLabel}
      </button>
    </section>
  );
}

function progressLabel(progress: number | null | undefined): string {
  if (progress == null) return "";
  const percent = progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
  return ` · ${percent}%`;
}
