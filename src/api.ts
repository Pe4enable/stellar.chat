import type { AuditReport, Finding, Quote, Severity } from "./types";

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

export function isUserAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

export async function prepareAudit(
  code: string,
  filename: string,
  signal: AbortSignal,
  archive?: string,
): Promise<{ sourceId: string; quotes: Quote[] }> {
  const data = await request("/api/audit", {
    method: "POST",
    body: JSON.stringify(archive ? { filename, archive } : { code, filename }),
    signal,
  });
  if (!Array.isArray(data.quotes) || typeof data.sourceId !== "string") {
    throw new AuditError("Savant did not return a price.");
  }
  return { sourceId: data.sourceId, quotes: data.quotes.map(asQuote) };
}

export async function startAudit(
  sourceId: string,
  tier: string,
  signal: AbortSignal,
): Promise<{ auditId: string; pollAfterSeconds: number; webUrl: string }> {
  const data = await request(`/api/audit/${encodeURIComponent(sourceId)}/start`, {
    method: "POST",
    body: JSON.stringify({ tier }),
    signal,
  });
  if (typeof data.auditId !== "string") throw new AuditError("Savant did not start the audit.");
  return {
    auditId: data.auditId,
    pollAfterSeconds: numberOr(data.pollAfterSeconds, 15),
    webUrl: typeof data.webUrl === "string" ? data.webUrl : "",
  };
}

export async function pollAudit(
  auditId: string,
  signal: AbortSignal,
): Promise<
  | { done: false; pollAfterSeconds: number; stage: string; progress: number | null; webUrl: string }
  | { done: true; report: AuditReport }
> {
  const data = await request(`/api/audit/${encodeURIComponent(auditId)}`, { method: "GET", signal });
  if (data.status === "failed") {
    throw new AuditError(typeof data.error === "string" ? data.error : "Savant stopped this audit.");
  }
  if (data.status === "completed") return { done: true, report: asReport(data) };
  return {
    done: false,
    pollAfterSeconds: numberOr(data.pollAfterSeconds, 15),
    stage: typeof data.stage === "string" ? data.stage : "Auditing",
    progress: typeof data.progress === "number" ? data.progress : null,
    webUrl: typeof data.webUrl === "string" ? data.webUrl : "",
  };
}

async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    if (isUserAbort(err)) throw err;
    throw new AuditError("The local audit server did not respond. Start the app with npm run dev.");
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : `The audit request failed (${response.status}).`;
    throw new AuditError(message);
  }
  if (!data || typeof data !== "object") throw new AuditError("The audit server returned an empty response.");
  return data;
}

function asQuote(value: unknown): Quote {
  const quote = isRecord(value) ? value : {};
  return {
    tier: stringOf(quote.tier),
    estimatedCost: stringOf(quote.estimatedCost),
    fileCount: numberOr(quote.fileCount, 0),
    tokenCount: numberOr(quote.tokenCount, 0),
    balanceAfter: stringOf(quote.balanceAfter),
    limitRemainingAfter: quote.limitRemainingAfter == null ? null : stringOf(quote.limitRemainingAfter),
    discountPercent: numberOr(quote.discountPercent, 0),
    standardCost: quote.standardCost == null ? null : stringOf(quote.standardCost),
  };
}

function asReport(data: Record<string, unknown>): AuditReport {
  const findings = Array.isArray(data.findings) ? data.findings.map(asFinding) : [];
  return {
    summary: stringOf(data.summary),
    text: stringOf(data.text),
    raw: stringOf(data.raw),
    webUrl: stringOf(data.webUrl),
    findings,
  };
}

function asFinding(value: unknown): Finding {
  const finding = isRecord(value) ? value : {};
  return {
    severity: asSeverity(stringOf(finding.severity)),
    title: stringOf(finding.title) || "Finding",
    detail: stringOf(finding.detail),
    location: stringOf(finding.location),
    recommendation: stringOf(finding.recommendation),
    verdict: stringOf(finding.verdict),
  };
}

function asSeverity(value: string): Severity {
  if (value === "critical" || value === "high" || value === "medium" || value === "low" || value === "info") {
    return value;
  }
  return "info";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
