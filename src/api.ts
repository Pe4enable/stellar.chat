import { languageFromFilename } from "./format";
import type { AuditReport, Finding, Severity } from "./types";

const TIMEOUT_MS = 20 * 60 * 1000;
const POLL_MS = 5000;

const PENDING = new Set([
  "pending",
  "queued",
  "queue",
  "running",
  "processing",
  "in_progress",
  "in-progress",
  "started",
  "working",
  "accepted",
]);

const FAILED = new Set(["failed", "error", "errored", "cancelled", "canceled", "failure"]);

const FINDING_KEYS = ["findings", "issues", "vulnerabilities", "alerts", "results", "checks"];

const SKIP_STRING_KEYS = new Set([
  "code",
  "source",
  "contract",
  "contract_code",
  "filename",
  "file",
  "language",
  "chain",
  "id",
  "job_id",
  "jobId",
  "task_id",
  "taskId",
  "status",
  "state",
]);

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

export function isEndpoint(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isUserAbort(err: unknown): boolean {
  return isRecord(err) && err.name === "AbortError";
}

type RunAuditInput = {
  code: string;
  filename: string;
  endpoint: string;
  apiKey: string;
  signal: AbortSignal;
};

export async function runAudit(input: RunAuditInput): Promise<AuditReport> {
  const signal = linkTimeout(input.signal, TIMEOUT_MS);
  const headers: Record<string, string> = {
    Accept: "application/json, text/markdown, text/plain",
  };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(auditRequestBody(input.code, input.filename)),
      signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const data = await readPayload(response);
    if (!response.ok && response.status !== 202) {
      throw new AuditError(errorMessage(data, response.status));
    }
    if (isFailed(data)) throw new AuditError(errorMessage(data, response.status));

    const pollUrl = jobPollUrl(input.endpoint, data);
    const finalPayload = pollUrl ? await pollUntilDone(pollUrl, headers, signal) : data;
    if (finalPayload == null || finalPayload === "") {
      throw new AuditError("The service returned an empty response.");
    }
    return normalizeReport(finalPayload);
  } catch (err) {
    if (isTimeout(err)) {
      throw new AuditError("The service did not respond within 20 minutes. The request was stopped.");
    }
    if (isUserAbort(err)) throw err;
    if (err instanceof AuditError) throw err;
    if (err instanceof TypeError) {
      throw new AuditError(
        "Could not reach the audit service. Check the URL, and that it allows browser requests (CORS). For local dev, set AUDIT_TARGET and use a /audit-service/… path.",
      );
    }
    throw new AuditError(err instanceof Error ? err.message : "The audit request failed.");
  }
}

export function auditRequestBody(code: string, filename: string) {
  return {
    code,
    filename,
    language: languageFromFilename(filename).id,
    chain: "stellar",
  };
}

export function normalizeReport(payload: unknown): AuditReport {
  const raw = toRaw(payload);
  const node = unwrap(payload);

  if (typeof node === "string") {
    return { summary: "", findings: [], text: node.trim(), raw };
  }
  if (Array.isArray(node)) {
    return { summary: "", findings: mapFindings(node), text: "", raw };
  }
  if (!isRecord(node)) {
    return { summary: "", findings: [], text: "", raw };
  }

  const findings = extractFindings(node);
  const summary = pickSummary(node);
  let text = pickText(node);
  if (!findings.length && !text) text = longestString(node);
  if (text.trim() === summary.trim()) text = "";
  if (findings.length && text.trim() === summary.trim()) text = "";
  return { summary, findings, text, raw };
}

async function pollUntilDone(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  for (;;) {
    await delay(POLL_MS, signal);
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal,
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const data = await readPayload(response);
    if (!response.ok) throw new AuditError(errorMessage(data, response.status));
    if (isFailed(data)) throw new AuditError(errorMessage(data));
    if (!isPending(data)) return data;
  }
}

function jobPollUrl(endpoint: string, data: unknown): string | null {
  if (!isRecord(data) || hasReport(data)) return null;
  const status = firstString(data, ["status", "state"]).toLowerCase();
  if (status && !PENDING.has(status)) return null;

  const explicit = firstString(data, ["poll_url", "pollUrl", "status_url", "statusUrl"]);
  if (explicit.startsWith("http://") || explicit.startsWith("https://")) return explicit;
  if (explicit.startsWith("/")) {
    const origin = endpoint.startsWith("/") ? window.location.origin : new URL(endpoint).origin;
    return origin + explicit;
  }

  const id = firstString(data, ["id", "job_id", "jobId", "task_id", "taskId"]);
  if (!id || !PENDING.has(status)) return null;
  return `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
}

function hasReport(data: Record<string, unknown>): boolean {
  if (extractFindings(data).length || pickSummary(data) || pickText(data)) return true;
  for (const key of ["result", "data", "report", "output", "audit"]) {
    const inner = data[key];
    if (typeof inner === "string" && inner.trim()) return true;
    if (isRecord(inner) && (extractFindings(inner).length || pickSummary(inner) || pickText(inner))) {
      return true;
    }
  }
  return false;
}

function isPending(data: unknown): boolean {
  if (!isRecord(data) || hasReport(data)) return false;
  const status = firstString(data, ["status", "state"]).toLowerCase();
  return PENDING.has(status);
}

function isFailed(data: unknown): boolean {
  if (!isRecord(data)) return false;
  const status = firstString(data, ["status", "state"]).toLowerCase();
  return FAILED.has(status);
}

function unwrap(payload: unknown): unknown {
  let current = payload;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current)) return current;
    if (extractFindings(current).length || pickSummary(current) || pickText(current)) return current;
    const next = unwrapOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function unwrapOnce(data: Record<string, unknown>): unknown {
  const choices = data.choices;
  if (Array.isArray(choices) && isRecord(choices[0]) && isRecord(choices[0].message)) {
    const content = choices[0].message.content;
    if (typeof content === "string" && content.trim()) return content;
  }

  if (Array.isArray(data.content)) {
    const text = data.content
      .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }

  for (const key of ["result", "data", "report", "output", "audit", "output_text"]) {
    const inner = data[key];
    if (typeof inner === "string" && inner.trim()) return inner;
    if (isRecord(inner) || Array.isArray(inner)) return inner;
  }

  return data;
}

function extractFindings(data: Record<string, unknown>): Finding[] {
  for (const key of FINDING_KEYS) {
    const value = data[key];
    if (Array.isArray(value) && (looksLikeFindings(value) || value.some((item) => typeof item === "string"))) {
      return mapFindings(value);
    }
    if (isRecord(value)) {
      const items = Object.values(value);
      if (looksLikeFindings(items)) return mapFindings(items);
    }
  }
  return [];
}

function looksLikeFindings(items: unknown[]): boolean {
  return items.some((item) => {
    if (!isRecord(item)) return false;
    return ["severity", "level", "risk", "title", "name", "description", "detail", "recommendation"].some(
      (key) => typeof item[key] === "string" && item[key].trim(),
    );
  });
}

function mapFindings(items: unknown[]): Finding[] {
  return items.flatMap((item, index) => {
    const finding = asFinding(item, index);
    return finding ? [finding] : [];
  });
}

function asFinding(item: unknown, index: number): Finding | null {
  if (typeof item === "string" && item.trim()) {
    return {
      severity: "info",
      title: item.trim().slice(0, 160),
      detail: item.trim(),
      location: "",
      recommendation: "",
    };
  }
  if (!isRecord(item)) return null;

  const title = firstString(item, ["title", "name", "check", "rule", "id", "type"]) || `Finding ${index + 1}`;
  const detail = firstString(item, ["description", "detail", "details", "explanation", "body", "issue", "message"]);
  const recommendation = firstString(item, ["recommendation", "remediation", "fix", "suggestion", "mitigation"]);
  return {
    severity: mapSeverity(firstString(item, ["severity", "level", "risk", "impact"])),
    title,
    detail,
    location: formatLocation(item),
    recommendation,
  };
}

function mapSeverity(value: string): Severity {
  const token = value.toLowerCase().replace(/[^a-z]+/g, " ");
  if (/\bcritical\b|\bcrit\b|\bsevere\b/.test(token)) return "critical";
  if (/\bhigh\b|\berror\b/.test(token)) return "high";
  if (/\bmedium\b|\bmoderate\b|\bwarning\b|\bwarn\b/.test(token)) return "medium";
  if (/\blow\b/.test(token)) return "low";
  return "info";
}

function formatLocation(item: Record<string, unknown>): string {
  if (typeof item.location === "string" && item.location.trim()) return item.location.trim();
  const file = firstString(item, ["file", "filename", "path", "contract"]);
  const line = item.line ?? item.line_number ?? item.start_line ?? item.startLine;
  const lineText = typeof line === "number" || typeof line === "string" ? String(line) : "";
  if (file && lineText) return `${file}:${lineText}`;
  if (file) return file;
  if (lineText) return `line ${lineText}`;
  return "";
}

function pickSummary(data: Record<string, unknown>): string {
  return firstString(data, ["summary", "overview", "conclusion"]);
}

function pickText(data: Record<string, unknown>): string {
  for (const key of ["analysis", "markdown", "text", "report_markdown", "details", "output_text"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof data.content === "string" && data.content.trim()) return data.content.trim();
  return "";
}

function longestString(data: Record<string, unknown>): string {
  let best = "";
  for (const [key, value] of Object.entries(data)) {
    if (SKIP_STRING_KEYS.has(key) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > best.length) best = trimmed;
  }
  return best.length > 40 ? best : "";
}

function firstString(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  return parseBody(text);
}

function parseBody(text: string): unknown {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (candidate.startsWith("{") || candidate.startsWith("[")) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function errorMessage(data: unknown, status?: number): string {
  const prefix = status ? `The service returned ${status}.` : "The audit service reported a failure.";
  if (typeof data === "string" && data.trim()) return `${prefix} ${snippet(data)}`;
  if (isRecord(data)) {
    const nested = data.error;
    if (typeof nested === "string" && nested.trim()) return `${prefix} ${nested.trim()}`;
    if (isRecord(nested)) {
      const nestedMessage = firstString(nested, ["message", "detail"]);
      if (nestedMessage) return `${prefix} ${nestedMessage}`;
    }
    const message = firstString(data, ["message", "detail", "details"]);
    if (message) return `${prefix} ${message}`;
  }
  const extra = snippet(data);
  return extra ? `${prefix} ${extra}` : prefix;
}

function snippet(data: unknown): string {
  if (data == null || data === "") return "";
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean === "null") return "";
  return clean.length > 280 ? `${clean.slice(0, 280)}…` : clean;
}

function toRaw(payload: unknown): string {
  let text: string;
  try {
    text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  } catch {
    text = String(payload);
  }
  return text.length > 100_000 ? `${text.slice(0, 100_000)}\n… truncated` : text;
}

function linkTimeout(user: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);

  const onUserAbort = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort(user.reason);
  };

  if (user.aborted) onUserAbort();
  else user.addEventListener("abort", onUserAbort, { once: true });
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
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

function isTimeout(err: unknown): boolean {
  return isRecord(err) && err.name === "TimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
