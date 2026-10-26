import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const BASE = "https://savant.chat";
const TIERS = ["lite", "advanced", "pro"];
const POLL_SECONDS = 30;
const QUOTE_TTL_MS = 30 * 60 * 1000;
const ACTIVE = new Set(["pending", "delayed", "processing_audit"]);

const quotes = new Map();
const audits = new Map();
let cachedKey = "";

function savantApiKey() {
  const fromEnv = process.env.SAVANT_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (cachedKey) return cachedKey;
  if (process.platform !== "darwin") return "";
  try {
    cachedKey = execFileSync("launchctl", ["getenv", "SAVANT_API_KEY"], { encoding: "utf8" }).trim();
  } catch {
    cachedKey = "";
  }
  return cachedKey;
}

function safeFilename(filename) {
  const base = path.basename(filename || "contract.rs").replace(/[^A-Za-z0-9._-]/g, "_");
  if (!base || base === "." || base === "..") return "contract.rs";
  return base.slice(0, 120);
}

function dashboardUrl(jobId) {
  return `${BASE}/dashboard/audits/${jobId}`;
}

class SavantError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SavantError";
    this.status = status;
  }
}

function errorMessage(status, data) {
  const err = data && typeof data === "object" ? data.error : null;
  if (!err) return `Savant returned ${status}.`;
  if (typeof err === "string") return err;
  const message = err.message || err.code || `Savant returned ${status}.`;
  if (err.code === "insufficient_funds") {
    return `${message} Balance ${err.current_balance}, required ${err.required}, shortfall ${err.shortfall}.`;
  }
  if (err.code === "monthly_limit_exceeded") {
    return `${message} Limit ${err.tier_cap}, spent ${err.current_spend}, this audit ${err.request_cost}, shortfall ${err.shortfall}. Resets ${err.reset_at}.`;
  }
  return message;
}

async function savant(pathname, { method = "GET", form, key }) {
  let response;
  try {
    response = await fetch(`${BASE}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
    });
  } catch {
    throw new SavantError("Could not reach Savant. Check the network connection.", 502);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new SavantError(errorMessage(response.status, data), response.status);
  }
  return data ?? {};
}

function fileForm(code, filename, tier) {
  const form = new FormData();
  form.append("tier", tier);
  form.append("file", new Blob([code]), safeFilename(filename));
  return form;
}

async function estimateTier(code, filename, tier, key) {
  const estimate = await savant("/api/v1/audit-jobs/estimate", {
    method: "POST",
    form: fileForm(code, filename, tier),
    key,
  });
  const files = Array.isArray(estimate.files) ? estimate.files : [];
  return {
    tier,
    estimatedCost: estimate.estimated_cost,
    fileCount: files.length,
    tokenCount: estimate.token_count ?? 0,
    balanceAfter: "",
    limitRemainingAfter: null,
    discountPercent: estimate.discount?.percent ?? 0,
    standardCost: estimate.discount?.standard_cost ?? null,
  };
}

async function prepareAudit(code, filename) {
  const key = savantApiKey();
  if (!key) {
    throw new SavantError("SAVANT_API_KEY is not set. Export it in the environment that launches this app.", 500);
  }

  const settled = await Promise.all(
    TIERS.map(async (tier) => {
      try {
        return { ok: true, quote: await estimateTier(code, filename, tier, key) };
      } catch (err) {
        return { ok: false, err };
      }
    }),
  );
  const priced = settled.filter((item) => item.ok).map((item) => item.quote);
  if (!priced.length) throw settled[0].err;

  const sourceId = randomUUID();
  quotes.set(sourceId, { code, filename, quotes: priced, createdAt: Date.now() });
  return { status: "estimate", sourceId, quotes: priced };
}

async function startAudit(sourceId, tier) {
  const pending = quotes.get(sourceId);
  if (!pending) throw new SavantError("That price expired. Run the audit again to get a new one.", 409);
  if (Date.now() - pending.createdAt > QUOTE_TTL_MS) {
    quotes.delete(sourceId);
    throw new SavantError("That price expired. Run the audit again to get a new one.", 409);
  }
  const quote = pending.quotes.find((item) => item.tier === tier);
  if (!quote) throw new SavantError("Pick one of the prices Savant returned.", 400);

  const key = savantApiKey();
  const created = await savant("/api/v1/audit-jobs", {
    method: "POST",
    form: fileForm(pending.code, pending.filename, tier),
    key,
  });
  quotes.delete(sourceId);

  const auditId = created.job_id;
  audits.set(auditId, {
    pollAfterSeconds: POLL_SECONDS,
    nextPollAt: Date.now() + POLL_SECONDS * 1000,
    webUrl: dashboardUrl(auditId),
    report: null,
    snapshot: {
      status: "running",
      stage: created.state || "pending",
      progress: null,
      pollAfterSeconds: POLL_SECONDS,
      webUrl: dashboardUrl(auditId),
    },
  });

  return {
    status: "running",
    auditId,
    estimatedCost: quote.estimatedCost,
    pollAfterSeconds: POLL_SECONDS,
    webUrl: dashboardUrl(auditId),
  };
}

function stageLabel(detail) {
  const events = Array.isArray(detail.stage_events) ? detail.stage_events : [];
  const latest = events[events.length - 1];
  if (!latest) return detail.state || "Auditing";
  const message = String(latest.message || "").trim();
  return message ? `${latest.stage}: ${message.slice(0, 140)}` : latest.stage;
}

function mapSeverity(value) {
  if (value === "critical" || value === "high" || value === "medium") return value;
  if (value === "low" || value === "minor") return "low";
  return "info";
}

function mapFinding(finding) {
  const file = finding.location?.file || "";
  const line = finding.location?.start_line;
  return {
    severity: mapSeverity(finding.severity),
    title: finding.title || "Finding",
    detail: finding.description_markdown || "",
    location: file && line ? `${file}:${line}` : file,
    recommendation: finding.recommendation_markdown || "",
    verdict: finding.verdict || "",
  };
}

function mapReport(detail, report) {
  return {
    status: "completed",
    summary: report.summary_markdown || "",
    text: "",
    raw: "",
    webUrl: dashboardUrl(detail.id),
    findings: Array.isArray(report.findings) ? report.findings.map(mapFinding) : [],
  };
}

async function readAudit(auditId) {
  const job = audits.get(auditId);
  if (!job) return null;
  if (job.report) return job.report;
  if (Date.now() < job.nextPollAt && job.snapshot) return job.snapshot;

  const key = savantApiKey();
  const detail = await savant(`/api/v1/audit-jobs/${encodeURIComponent(auditId)}`, { key });
  job.nextPollAt = Date.now() + POLL_SECONDS * 1000;
  const state = detail.state;

  if (state === "failed" || state === "cancelled") {
    const events = Array.isArray(detail.stage_events) ? detail.stage_events : [];
    const failed = [...events].reverse().find((event) => event.status === "failed");
    const snapshot = {
      status: "failed",
      error: failed?.message || `Savant marked this audit as ${state}.`,
    };
    job.snapshot = snapshot;
    return snapshot;
  }

  if (state === "completed") {
    const report = detail.report ?? (await savant(`/api/v1/audit-jobs/${encodeURIComponent(auditId)}/report`, { key }));
    job.report = mapReport(detail, report);
    return job.report;
  }

  if (!ACTIVE.has(state)) {
    const snapshot = { status: "failed", error: `Savant returned an unexpected state: ${state}.` };
    job.snapshot = snapshot;
    return snapshot;
  }

  job.snapshot = {
    status: "running",
    stage: stageLabel(detail),
    progress: typeof detail.progress === "number" ? detail.progress : null,
    pollAfterSeconds: POLL_SECONDS,
    webUrl: job.webUrl,
  };
  return job.snapshot;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("The contract is larger than 1 MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleAuditRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/audit")) return false;

  try {
    if (req.method === "POST" && url.pathname === "/api/audit") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const code = typeof body.code === "string" ? body.code : "";
      const filename = typeof body.filename === "string" ? body.filename : "contract.rs";
      if (!code.trim()) {
        send(res, 400, { error: "Paste a contract first." });
        return true;
      }
      send(res, 200, await prepareAudit(code, filename));
      return true;
    }

    const start = /^\/api\/audit\/([^/]+)\/start$/.exec(url.pathname);
    if (req.method === "POST" && start) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const tier = typeof body.tier === "string" ? body.tier : "";
      send(res, 200, await startAudit(decodeURIComponent(start[1]), tier));
      return true;
    }

    const status = /^\/api\/audit\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && status) {
      const audit = await readAudit(decodeURIComponent(status[1]));
      if (!audit) {
        send(res, 404, { error: "This audit is no longer on the local server. Open it from the Savant dashboard." });
        return true;
      }
      send(res, 200, audit);
      return true;
    }

    send(res, 404, { error: "Unknown audit route." });
    return true;
  } catch (err) {
    if (res.writableEnded) return true;
    const message = err instanceof Error ? err.message : "Savant request failed.";
    const status = err instanceof SavantError ? err.status : 502;
    send(res, status >= 400 && status < 600 ? status : 502, { error: message });
    return true;
  }
}
