import { useMemo, useState } from "react";
import { formatElapsed, languageFromFilename } from "../format";
import { renderMarkdown } from "../markdown";
import { SEVERITIES, SEVERITY_LABEL, type AuditReport, type Severity } from "../types";

type Props = {
  filename: string;
  elapsedMs: number;
  report: AuditReport;
  onBack: () => void;
};

export function ReportView({ filename, elapsedMs, report, onBack }: Props) {
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const language = languageFromFilename(filename);

  const ordered = useMemo(() => {
    const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return report.findings
      .map((finding, index) => ({ finding, index }))
      .sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity] || a.index - b.index)
      .map(({ finding }) => finding);
  }, [report.findings]);

  const counts = useMemo(() => {
    const tally = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of report.findings) tally[finding.severity] += 1;
    return tally;
  }, [report.findings]);

  const visible = filter === "all" ? ordered : ordered.filter((finding) => finding.severity === filter);
  const findingLabel = `${report.findings.length} ${report.findings.length === 1 ? "finding" : "findings"}`;
  const auditId = auditIdFromWebUrl(report.webUrl);
  const showRaw = !report.findings.length && !report.text && !report.summary;

  async function downloadPdf() {
    if (!auditId || downloading) return;
    setDownloading(true);
    setPdfError("");
    try {
      const response = await fetch(`/api/audit/${encodeURIComponent(auditId)}/report.pdf`);
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Savant could not build the PDF yet.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stem = filename.replace(/\.[^.]+$/, "") || "audit";
      link.href = url;
      link.download = `${stem}-report.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  async function copyReport() {
    const blocks = [
      `${filename}`,
      `Stellar · ${language.label} · finished in ${formatElapsed(elapsedMs)}`,
      report.summary,
      report.text,
      ...ordered.map((finding) => {
        const lines = [`[${finding.severity}] ${finding.title}`];
        if (finding.location) lines.push(finding.location);
        if (finding.detail) lines.push(finding.detail);
        if (finding.recommendation) lines.push(`Recommendation: ${finding.recommendation}`);
        return lines.join("\n");
      }),
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(blocks.join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="report">
      <header className="report-head">
        <div>
          <p className="kicker">Audit report</p>
          <h2>{filename}</h2>
          <p className="meta">
            Stellar · {language.label} · {findingLabel} · finished in {formatElapsed(elapsedMs)}
            {report.webUrl ? (
              <>
                {" · "}
                <a className="text-link" href={report.webUrl} target="_blank" rel="noreferrer">
                  Open on savant.chat
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="row">
          {auditId ? (
            <button className="btn ghost" type="button" disabled={downloading} onClick={() => void downloadPdf()}>
              {downloading ? "Downloading…" : "Download in pdf"}
            </button>
          ) : null}
          <button className="btn ghost" type="button" onClick={() => void copyReport()}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn primary" type="button" onClick={onBack}>
            Back to code
          </button>
        </div>
      </header>

      {pdfError ? (
        <p className="banner" role="alert">
          {pdfError}
        </p>
      ) : null}

      {report.summary ? (
        <div className="prose summary" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.summary) }} />
      ) : null}

      {report.text ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.text) }} />
      ) : null}

      {ordered.length ? (
        <>
          <div className="chips" role="toolbar" aria-label="Filter findings">
            <button
              className="chip"
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All · {ordered.length}
            </button>
            {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
              <button
                key={severity}
                className="chip"
                type="button"
                aria-pressed={filter === severity}
                onClick={() => setFilter(severity)}
              >
                {SEVERITY_LABEL[severity]} · {counts[severity]}
              </button>
            ))}
          </div>
          <div className="findings">
            {visible.map((finding, index) => (
              <article key={`${finding.title}-${index}`} className={`finding sev-${finding.severity}`}>
                <div className="finding-top">
                  <span className={`sev-label sev-${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
                  {finding.verdict ? <span className="loc">{finding.verdict}</span> : null}
                  {finding.location ? <span className="loc">{finding.location}</span> : null}
                </div>
                <h3>{finding.title}</h3>
                {finding.detail ? (
                  <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(finding.detail) }} />
                ) : null}
                {finding.recommendation ? (
                  <div className="rec">
                    <span>Recommendation</span>
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(finding.recommendation) }}
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}

      {showRaw ? <p className="lead">Savant returned a report without individual findings.</p> : null}

      {report.raw ? (
        <details className="raw" open={showRaw}>
          <summary>Raw response</summary>
          <pre>{report.raw}</pre>
        </details>
      ) : null}
    </section>
  );
}

function auditIdFromWebUrl(webUrl: string | undefined): string {
  const match = /\/audits\/([0-9a-f-]{36})/i.exec(webUrl || "");
  return match?.[1] ?? "";
}
