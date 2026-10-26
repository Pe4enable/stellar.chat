import { useEffect, useState } from "react";
import { formatElapsed } from "../format";

const WINDOW_MS = 30 * 60 * 1000;

type Props = {
  startedAt: number;
  filename: string;
  lines: number;
  detail?: string;
  note: string;
  kicker?: string;
  showWindow?: boolean;
  stage?: string;
  progress?: number | null;
  cancelLabel: string;
  webUrl?: string;
  onCancel: () => void;
};

export function WaitScreen({
  startedAt,
  filename,
  lines,
  detail,
  note,
  kicker = "Audit in progress",
  showWindow = true,
  stage,
  progress,
  cancelLabel,
  webUrl,
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
      {note ? <p className="lead">{note}</p> : null}
      <p className="meta">
        {filename}
        {detail ? ` · ${detail}` : ` · ${lines} ${lines === 1 ? "line" : "lines"}`}
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
              ? "Past the usual 30-minute window. Still waiting on Savant."
              : "Depending on the size, an audit can take 15–30 minutes."}
          </p>
        </>
      ) : null}
      {webUrl ? (
        <a className="text-link" href={webUrl} target="_blank" rel="noreferrer">
          Open on savant.chat
        </a>
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
