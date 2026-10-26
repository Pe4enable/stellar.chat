import { exec, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const MCP_URL = "https://savant.chat/mcp";
const SOURCE_DEADLINE_MS = 3 * 60 * 1000;

const quotes = new Map();
const audits = new Map();
let rpcId = 0;
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

function publicError(err) {
  const message = err instanceof Error ? err.message : "Savant request failed.";
  return message.replace(/https?:\/\/(?!(?:www\.)?savant\.chat\/)\S+/g, "[url]");
}

async function callTool(name, args) {
  const key = savantApiKey();
  if (!key) {
    throw new Error("SAVANT_API_KEY is not set. Export it in the environment that launches this app.");
  }

  let response;
  try {
    response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  } catch {
    throw new Error("Could not reach Savant. Check the network connection.");
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "Savant rejected the request.");
  }

  const result = payload.result ?? {};
  if (result.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map((part) => part.text).filter(Boolean).join("\n")
      : "";
    throw new Error(text || result.structuredContent?.message || "Savant rejected the request.");
  }

  return result.structuredContent ?? {};
}

function safeFilename(filename) {
  const base = path.basename(filename || "contract.rs").replace(/[^A-Za-z0-9._-]/g, "_");
  if (!base || base === "." || base === "..") return "contract.rs";
  return base.slice(0, 120);
}

async function stageProject(code, filename) {
  const dir = path.join(tmpdir(), `stellar-audit-${randomBytes(8).toString("hex")}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, safeFilename(filename)), code);
  try {
    await execAsync(
      "git init -q && git add -A && git -c user.email=audit@stellar.local -c user.name=stellar commit -q -m audit",
      { cwd: dir, timeout: 20000 },
    );
  } catch {
    /* The upload command can still pack a plain directory. */
  }
  return dir;
}

async function runUploadCommand(command, cwd) {
  try {
    await execAsync(command, { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const detail = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    throw new Error(`The upload to Savant failed. ${publicError(new Error(detail)).slice(0, 300)}`.trim());
  }
}

async function waitForSource(sourceId, isCancelled) {
  const deadline = Date.now() + SOURCE_DEADLINE_MS;
  for (;;) {
    if (isCancelled()) return null;
    const source = await callTool("get_source", { source_id: sourceId });
    const status = String(source.status || "").toLowerCase();
    if (status === "completed") {
      if (source.file_count === 0) {
        throw new Error(source.next_step || "Savant accepted the upload but kept no files.");
      }
      return source;
    }
    if (status === "failed" || status === "error" || source.error_code) {
      throw new Error(source.next_step || source.error_code || "Savant could not process the upload.");
    }
    if (Date.now() > deadline) throw new Error("Savant is still processing the upload.");
    await delay(2000);
  }
}

function mapQuote(quote) {
  return {
    tier: quote.tier,
    estimatedCost: quote.estimated_cost,
    fileCount: quote.selected_file_count,
    tokenCount: quote.token_count,
    balanceAfter: quote.balance_after,
    limitRemainingAfter: quote.limit_remaining_after,
    discountPercent: quote.discount?.percent ?? 0,
    standardCost: quote.discount?.standard_cost ?? null,
  };
}

function mapSeverity(value) {
  const token = String(value || "").toLowerCase();
  if (token === "critical") return "critical";
  if (token === "high") return "high";
  if (token === "medium") return "medium";
  if (token === "low" || token === "minor") return "low";
  return "info";
}

function locationOf(finding) {
  const location = finding.location ?? finding;
  const file = location.file || finding.file || "";
  const line = location.start_line ?? finding.start_line;
  if (file && line != null) return `${file}:${line}`;
  return file;
}

async function collectFindings(auditId) {
  const findings = [];
  let cursor;
  for (let page = 0; page < 5; page += 1) {
    const listed = await callTool("list_findings", cursor ? { audit_id: auditId, cursor } : { audit_id: auditId });
    for (const item of listed.items ?? []) {
      let detail = "";
      let recommendation = "";
      let severity = mapSeverity(item.severity);
      let title = item.title || "Finding";
      let location = locationOf(item);
      let verdict = item.verdict || "";
      try {
        const full = await callTool("get_finding", { audit_id: auditId, finding_id: item.finding_id });
        detail = full.description_markdown || "";
        recommendation = full.recommendation_markdown || "";
        severity = mapSeverity(full.severity || item.severity);
        title = full.title || title;
        location = locationOf(full);
        verdict = full.verdict || verdict;
      } catch {
        /* The list row is still enough to show the finding. */
      }
      findings.push({ severity, title, detail, location, recommendation, verdict });
      if (findings.length >= 40) return findings;
    }
    if (!listed.next_cursor) break;
    cursor = listed.next_cursor;
  }
  return findings;
}

function rememberAudit(started) {
  audits.set(started.audit_id, {
    pollAfterSeconds: started.poll_after_seconds || 15,
    nextPollAt: Date.now() + (started.poll_after_seconds || 15) * 1000,
    webUrl: started.web_url,
    estimatedCost: started.estimated_cost,
    report: null,
    snapshot: {
      status: "running",
      stage: "Queued",
      progress: 0,
      pollAfterSeconds: started.poll_after_seconds || 15,
      webUrl: started.web_url,
    },
  });
}

async function readAudit(auditId) {
  const job = audits.get(auditId);
  if (!job) return null;
  if (job.report) return job.report;
  if (Date.now() < job.nextPollAt && job.snapshot) return job.snapshot;

  const audit = await callTool("get_audit", { audit_id: auditId });
  const pollAfterSeconds = audit.poll_after_seconds || job.pollAfterSeconds || 15;
  job.pollAfterSeconds = pollAfterSeconds;
  job.nextPollAt = Date.now() + pollAfterSeconds * 1000;
  job.webUrl = audit.web_url || job.webUrl;

  const state = String(audit.state || "").toLowerCase();
  if (state === "failed" || state === "error" || state === "cancelled" || state === "canceled") {
    const failed = { status: "failed", error: audit.stage || "Savant stopped this audit." };
    job.snapshot = failed;
    return failed;
  }

  if (state === "completed") {
    const findings = await collectFindings(auditId);
    job.report = {
      status: "completed",
      summary: audit.summary_markdown || "",
      text: "",
      raw: "",
      webUrl: audit.web_url || job.webUrl || "",
      findings,
    };
    return job.report;
  }

  job.snapshot = {
    status: "running",
    stage: audit.stage || "Auditing",
    progress: typeof audit.progress === "number" ? audit.progress : null,
    pollAfterSeconds,
    webUrl: job.webUrl || "",
  };
  return job.snapshot;
}

async function prepareAudit(code, filename, isCancelled) {
  const upload = await callTool("create_source_upload", {});
  if (isCancelled()) return null;
  if (Buffer.byteLength(code) > upload.max_bytes) {
    throw new Error("This contract is larger than Savant will accept in one upload.");
  }

  const dir = await stageProject(code, filename);
  try {
    if (isCancelled()) return null;
    await runUploadCommand(upload.command, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (isCancelled()) return null;
  const ready = await waitForSource(upload.source_id, isCancelled);
  if (!ready) return null;
  const priced = await callTool("estimate_audit", { source_id: upload.source_id });
  const mapped = (priced.quotes ?? []).map(mapQuote);
  quotes.set(upload.source_id, mapped);
  return { status: "estimate", sourceId: upload.source_id, quotes: mapped };
}

async function startAudit(sourceId, tier) {
  const options = quotes.get(sourceId);
  if (!options) throw new Error("That price expired. Run the audit again to get a new one.");
  const quote = options.find((item) => item.tier === tier);
  if (!quote) throw new Error("Pick one of the prices Savant returned.");
  const started = await callTool("start_audit", {
    source_id: sourceId,
    tier,
    max_cost_usd: quote.estimatedCost,
  });
  rememberAudit(started);
  return {
    status: "running",
    auditId: started.audit_id,
    estimatedCost: started.estimated_cost,
    pollAfterSeconds: started.poll_after_seconds,
    webUrl: started.web_url,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      let clientGone = false;
      req.on("close", () => {
        if (!res.writableEnded) clientGone = true;
      });
      const body = JSON.parse((await readBody(req)) || "{}");
      const code = typeof body.code === "string" ? body.code : "";
      const filename = typeof body.filename === "string" ? body.filename : "contract.rs";
      if (!code.trim()) {
        send(res, 400, { error: "Paste a contract first." });
        return true;
      }
      const prepared = await prepareAudit(code, filename, () => clientGone);
      if (clientGone || !prepared) return true;
      send(res, 200, prepared);
      return true;
    }

    const start = /^\/api\/audit\/([^/]+)\/start$/.exec(url.pathname);
    if (req.method === "POST" && start) {
      const body = JSON.parse((await readBody(req)) || "{}");
      const tier = typeof body.tier === "string" ? body.tier : "";
      const started = await startAudit(decodeURIComponent(start[1]), tier);
      send(res, 200, started);
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
    const message = publicError(err);
    const status = /not allowed|limit|402|balance|budget/i.test(message) ? 402 : 502;
    send(res, status, { error: message });
    return true;
  }
}
