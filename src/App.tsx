import { useCallback, useEffect, useState } from "react";
import { delay, isUserAbort, pollAudit, prepareAudit, startAudit } from "./api";
import { Editor } from "./components/Editor";
import { QuoteScreen } from "./components/QuoteScreen";
import { ReportView } from "./components/ReportView";
import { WaitScreen } from "./components/WaitScreen";
import { formatElapsed, lineCount } from "./format";
import { SAMPLE, SAMPLE_FILENAME } from "./sample";
import {
  clearActiveAudit,
  forgetStoredKey,
  readActiveAudit,
  readLocal,
  writeActiveAudit,
  writeLocal,
} from "./storage";
import type { Phase, Quote } from "./types";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function storedIsPreviousExample(): boolean {
  const storedCode = readLocal("code");
  if (!storedCode) return false;
  if (readLocal("filename") === "vault.rs" && storedCode.includes("pub struct Vault")) return true;
  return (
    readLocal("filename") === SAMPLE_FILENAME &&
    storedCode.includes("fn transfer_internal") &&
    !storedCode.includes("Vulnerability:")
  );
}

function initialPhase(): Phase {
  const active = readActiveAudit();
  if (!active) return { name: "edit" };
  return {
    name: "running",
    startedAt: active.startedAt,
    auditId: active.auditId,
    pollAfterSeconds: active.pollAfterSeconds,
    webUrl: active.webUrl,
  };
}

export function App() {
  const [code, setCode] = useState(() => (storedIsPreviousExample() ? SAMPLE : readLocal("code") ?? SAMPLE));
  const [filename, setFilename] = useState(() =>
    storedIsPreviousExample() ? SAMPLE_FILENAME : readLocal("filename") ?? SAMPLE_FILENAME,
  );
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [banner, setBanner] = useState("");
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const shortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

  useEffect(() => {
    forgetStoredKey();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => writeLocal("code", code), 250);
    return () => window.clearTimeout(id);
  }, [code]);

  useEffect(() => {
    writeLocal("filename", filename);
  }, [filename]);

  useEffect(() => {
    document.body.dataset.phase = phase.name;
    if (phase.name !== "running" && phase.name !== "preparing") {
      document.title =
        phase.name === "done"
          ? "Report — stellar.chat"
          : phase.name === "confirm"
            ? "Choose an audit — stellar.chat"
            : phase.name === "error"
              ? "Audit failed — stellar.chat"
              : "stellar.chat — contract audit";
      return;
    }

    const tick = () => {
      const label = phase.name === "preparing" ? "Pricing" : "Audit";
      document.title = `${label} · ${formatElapsed(Date.now() - phase.startedAt)} — stellar.chat`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "preparing") return;
    const controller = new AbortController();
    const startedAt = phase.startedAt;
    let active = true;

    prepareAudit(code, filename, controller.signal)
      .then((priced) => {
        if (!active) return;
        if (!priced.quotes.length) {
          setPhase({
            name: "error",
            message: "Savant did not return a price for this contract.",
            elapsedMs: Date.now() - startedAt,
          });
          return;
        }
        setPhase({ name: "confirm", startedAt, sourceId: priced.sourceId, quotes: priced.quotes });
      })
      .catch((err: unknown) => {
        if (!active || isUserAbort(err)) return;
        const message = err instanceof Error ? err.message : "Savant could not price this contract.";
        setPhase({ name: "error", message, elapsedMs: Date.now() - startedAt });
      });

    return () => {
      active = false;
      controller.abort();
    };
    // The upload is sealed when pricing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "running") return;
    const controller = new AbortController();
    const startedAt = phase.startedAt;
    const auditId = phase.auditId;
    let active = true;
    let waitMs = phase.pollAfterSeconds * 1000;

    writeActiveAudit({
      auditId,
      startedAt,
      pollAfterSeconds: phase.pollAfterSeconds,
      webUrl: phase.webUrl,
    });

    (async () => {
      try {
        for (;;) {
          await delay(waitMs, controller.signal);
          if (!active) return;
          const update = await pollAudit(auditId, controller.signal);
          if (!active) return;
          if (update.done) {
            clearActiveAudit();
            setPhase({ name: "done", report: update.report, elapsedMs: Date.now() - startedAt });
            return;
          }
          setStage(update.stage);
          setProgress(update.progress);
          waitMs = update.pollAfterSeconds * 1000;
        }
      } catch (err) {
        if (!active || isUserAbort(err)) return;
        clearActiveAudit();
        const message = err instanceof Error ? err.message : "The audit failed.";
        setPhase({ name: "error", message, elapsedMs: Date.now() - startedAt });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
    // Polling follows this audit id. Stage updates stay outside this object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name === "running" ? phase.auditId : ""]);

  const onFile = useCallback(async (file: File) => {
    if (file.size > 1_000_000) {
      setBanner("That file is over 1 MB. Paste a smaller contract.");
      return;
    }
    const text = await file.text();
    if (text.includes("\u0000")) {
      setBanner("That file does not look like source code.");
      return;
    }
    setBanner("");
    setCode(text);
    setFilename(file.name);
  }, []);

  useEffect(() => {
    if (phase.name !== "edit") return;
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragging(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void onFile(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop, true);
    return () => {
      depth = 0;
      setDragging(false);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [phase.name, onFile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase.name !== "edit") return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        price();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function price() {
    if (!code.trim() || phase.name === "preparing" || phase.name === "running") return;
    setBanner("");
    setStage("");
    setProgress(null);
    setPhase({ name: "preparing", startedAt: Date.now() });
  }

  async function confirm(quote: Quote) {
    if (phase.name !== "confirm" || starting) return;
    const startedAt = phase.startedAt;
    setStarting(true);
    try {
      const started = await startAudit(phase.sourceId, quote.tier, new AbortController().signal);
      setStage("Queued");
      setProgress(0);
      setPhase({
        name: "running",
        startedAt,
        auditId: started.auditId,
        pollAfterSeconds: started.pollAfterSeconds,
        webUrl: started.webUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Savant did not start the audit.";
      setPhase({ name: "error", message, elapsedMs: Date.now() - startedAt });
    } finally {
      setStarting(false);
    }
  }

  function backToCode() {
    clearActiveAudit();
    setPhase({ name: "edit" });
  }

  return (
    <div className="app" data-phase={phase.name}>
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="18" height="18">
              <path
                fill="currentColor"
                d="M16 2.2 18.8 13.2 29.8 16 18.8 18.8 16 29.8 13.2 18.8 2.2 16 13.2 13.2Z"
              />
            </svg>
          </span>
          <div>
            <p className="brand-name">stellar.chat</p>
            <p className="brand-sub">Stellar smart contract audit</p>
          </div>
        </div>
      </header>

      <main className="main">
        {banner && phase.name === "edit" ? (
          <p className="banner" role="alert">
            {banner}
          </p>
        ) : null}

        {phase.name === "edit" ? (
          <Editor
            code={code}
            filename={filename}
            shortcut={shortcut}
            onCode={(value) => {
              setCode(value);
              if (banner) setBanner("");
            }}
            onFilename={setFilename}
            onSubmit={price}
            onLoadExample={() => {
              if (code.trim() && code !== SAMPLE && !window.confirm("Replace the current contract with the example?")) {
                return;
              }
              setCode(SAMPLE);
              setFilename(SAMPLE_FILENAME);
              setBanner("");
            }}
            onClear={() => {
              setCode("");
              setBanner("");
            }}
            onFile={(file) => void onFile(file)}
          />
        ) : null}

        {phase.name === "preparing" ? (
          <WaitScreen
            startedAt={phase.startedAt}
            filename={filename}
            lines={lineCount(code)}
            note="Uploading the contract to Savant and asking for a price. Keep this tab open."
            kicker="Pricing"
            showWindow={false}
            cancelLabel="Cancel"
            onCancel={backToCode}
          />
        ) : null}

        {phase.name === "confirm" ? (
          <QuoteScreen quotes={phase.quotes} busy={starting} onStart={(quote) => void confirm(quote)} onBack={backToCode} />
        ) : null}

        {phase.name === "running" ? (
          <WaitScreen
            startedAt={phase.startedAt}
            filename={filename}
            lines={lineCount(code)}
            note="Savant is auditing the contract. You can close this tab; the audit keeps running, and a completion email may arrive."
            stage={stage}
            progress={progress}
            cancelLabel="Back to code"
            webUrl={phase.webUrl}
            onCancel={backToCode}
          />
        ) : null}

        {phase.name === "done" ? (
          <ReportView
            filename={filename}
            elapsedMs={phase.elapsedMs}
            report={phase.report}
            onBack={backToCode}
          />
        ) : null}

        {phase.name === "error" ? (
          <section className="center-panel">
            <p className="kicker">Audit stopped</p>
            <h2>No report came back</h2>
            <p className="lead">{phase.message}</p>
            <div className="row">
              <button className="btn primary" type="button" onClick={price}>
                Try again
              </button>
              <button className="btn ghost" type="button" onClick={backToCode}>
                Back to code
              </button>
            </div>
          </section>
        ) : null}
      </main>

      {dragging ? (
        <div className="drop-overlay">
          <p>Drop the contract file</p>
        </div>
      ) : null}
    </div>
  );
}
