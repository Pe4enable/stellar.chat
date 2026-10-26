import { useCallback, useEffect, useState } from "react";
import { isEndpoint, isUserAbort, runAudit } from "./api";
import { Editor } from "./components/Editor";
import { ReportView } from "./components/ReportView";
import { SettingsDialog } from "./components/SettingsDialog";
import { WaitScreen } from "./components/WaitScreen";
import { formatElapsed, lineCount } from "./format";
import { SAMPLE, SAMPLE_FILENAME } from "./sample";
import { readLocal, writeLocal } from "./storage";
import type { Phase } from "./types";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function App() {
  const [code, setCode] = useState(() => readLocal("code") ?? SAMPLE);
  const [filename, setFilename] = useState(() => readLocal("filename") ?? SAMPLE_FILENAME);
  const [endpoint, setEndpoint] = useState(
    () => readLocal("endpoint") ?? import.meta.env.VITE_AUDIT_ENDPOINT ?? "",
  );
  const [apiKey, setApiKey] = useState(() => readLocal("apiKey") ?? "");
  const [phase, setPhase] = useState<Phase>({ name: "edit" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpointError, setEndpointError] = useState("");
  const [banner, setBanner] = useState("");
  const [dragging, setDragging] = useState(false);

  const shortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

  useEffect(() => {
    const id = window.setTimeout(() => writeLocal("code", code), 250);
    return () => window.clearTimeout(id);
  }, [code]);

  useEffect(() => {
    writeLocal("filename", filename);
  }, [filename]);

  useEffect(() => {
    writeLocal("endpoint", endpoint);
  }, [endpoint]);

  useEffect(() => {
    writeLocal("apiKey", apiKey);
  }, [apiKey]);

  useEffect(() => {
    document.body.dataset.phase = phase.name;
    if (phase.name === "running") {
      const tick = () => {
        document.title = `Audit · ${formatElapsed(Date.now() - phase.startedAt)} — stellar.chat`;
      };
      tick();
      const id = window.setInterval(tick, 1000);
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => {
        window.clearInterval(id);
        window.removeEventListener("beforeunload", warn);
      };
    }

    document.title =
      phase.name === "done"
        ? "Report — stellar.chat"
        : phase.name === "error"
          ? "Audit failed — stellar.chat"
          : "stellar.chat — contract audit";
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (phase.name !== "running") return;
    const controller = new AbortController();
    const startedAt = phase.startedAt;
    let active = true;

    runAudit({
      code,
      filename,
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim(),
      signal: controller.signal,
    })
      .then((report) => {
        if (!active) return;
        setPhase({ name: "done", report, elapsedMs: Date.now() - startedAt });
      })
      .catch((err: unknown) => {
        if (!active || isUserAbort(err)) return;
        const message = err instanceof Error ? err.message : "The audit failed.";
        setPhase({ name: "error", message, elapsedMs: Date.now() - startedAt });
      });

    return () => {
      active = false;
      controller.abort();
    };
    // The run is sealed when `phase` becomes "running". Later edits must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
      if (settingsOpen || phase.name !== "edit") return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function start() {
    if (!code.trim() || phase.name === "running") return;
    if (!isEndpoint(endpoint.trim())) {
      setEndpointError("Enter the audit service URL — https://… or a path like /audit-service/…");
      setSettingsOpen(true);
      return;
    }
    setEndpointError("");
    setBanner("");
    setPhase({ name: "running", startedAt: Date.now() });
  }

  function loadExample() {
    if (code.trim() && code !== SAMPLE && !window.confirm("Replace the current contract with the example?")) return;
    setCode(SAMPLE);
    setFilename(SAMPLE_FILENAME);
    setBanner("");
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
        {phase.name === "edit" || phase.name === "error" ? (
          <button className="btn small ghost" type="button" onClick={() => setSettingsOpen(true)}>
            Service
          </button>
        ) : null}
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
            endpoint={endpoint}
            shortcut={shortcut}
            onCode={(value) => {
              setCode(value);
              if (banner) setBanner("");
            }}
            onFilename={setFilename}
            onSubmit={start}
            onOpenSettings={() => setSettingsOpen(true)}
            onLoadExample={loadExample}
            onClear={() => {
              setCode("");
              setBanner("");
            }}
            onFile={(file) => void onFile(file)}
          />
        ) : null}

        {phase.name === "running" ? (
          <WaitScreen
            startedAt={phase.startedAt}
            filename={filename}
            lines={lineCount(code)}
            endpoint={endpoint}
            onCancel={() => setPhase({ name: "edit" })}
          />
        ) : null}

        {phase.name === "done" ? (
          <ReportView
            filename={filename}
            elapsedMs={phase.elapsedMs}
            report={phase.report}
            onBack={() => setPhase({ name: "edit" })}
          />
        ) : null}

        {phase.name === "error" ? (
          <section className="center-panel">
            <p className="kicker">Audit stopped</p>
            <h2>No report came back</h2>
            <p className="lead">{phase.message}</p>
            <div className="row">
              <button className="btn primary" type="button" onClick={start}>
                Try again
              </button>
              <button className="btn ghost" type="button" onClick={() => setSettingsOpen(true)}>
                Check endpoint
              </button>
              <button className="btn ghost" type="button" onClick={() => setPhase({ name: "edit" })}>
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

      <SettingsDialog
        open={settingsOpen}
        endpoint={endpoint}
        apiKey={apiKey}
        error={endpointError}
        onEndpoint={(value) => {
          setEndpoint(value);
          if (endpointError) setEndpointError("");
        }}
        onApiKey={setApiKey}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
