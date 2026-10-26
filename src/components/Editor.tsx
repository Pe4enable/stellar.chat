import { useRef, type KeyboardEvent } from "react";
import { languageFromFilename, lineCount } from "../format";

type Props = {
  code: string;
  filename: string;
  shortcut: string;
  archiveLabel?: string;
  onCode: (value: string) => void;
  onFilename: (value: string) => void;
  onSubmit: () => void;
  onLoadExample: () => void;
  onClear: () => void;
  onFile: (file: File) => void;
  onArchive: (file: File) => void;
};

export function Editor({
  code,
  filename,
  shortcut,
  onCode,
  onFilename,
  onSubmit,
  onLoadExample,
  onClear,
  onFile,
  onArchive,
  archiveLabel,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);
  const lines = lineCount(code);
  const numbers = Array.from({ length: Math.max(lines, 1) }, (_, index) => index + 1).join("\n");
  const language = languageFromFilename(filename);

  function syncScroll() {
    if (areaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${code.slice(0, start)}    ${code.slice(end)}`;
    onCode(next);
    requestAnimationFrame(() => {
      element.selectionStart = element.selectionEnd = start + 4;
    });
  }

  return (
    <section className="editor">
      <div className="editor-bar">
        <input
          className="filename"
          value={filename}
          aria-label="File name"
          spellCheck={false}
          onChange={(event) => onFilename(event.target.value)}
        />
        <span className="badge">{language.label}</span>
        <span className="quiet">
          {archiveLabel ? archiveLabel : `${lines} ${lines === 1 ? "line" : "lines"}`}
        </span>
        <div className="bar-actions">
          <button className="btn small ghost" type="button" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <button className="btn small ghost" type="button" onClick={() => archiveRef.current?.click()}>
            Archive
          </button>
          <button className="btn small ghost" type="button" onClick={onLoadExample}>
            Example
          </button>
          <button className="btn small ghost" type="button" onClick={onClear} disabled={!code && !archiveLabel}>
            Clear
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".rs,.sol,.cairo,.move,.txt,.md"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
        <input
          ref={archiveRef}
          type="file"
          hidden
          accept=".zip,.tar,.tgz,.gz,application/zip,application/gzip,application/x-tar"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onArchive(file);
          }}
        />
      </div>

      {archiveLabel ? (
        <div className="archive-hold">
          <p className="kicker">Archive</p>
          <h2>{filename}</h2>
          <p>The archive is sent to Savant as uploaded. Source is not shown here.</p>
        </div>
      ) : (
      <div className="editor-body">
        <pre ref={gutterRef} className="gutter" aria-hidden="true">{numbers}</pre>
        <textarea
          ref={areaRef}
          className="code-input"
          value={code}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Contract source"
          placeholder="Paste a Soroban contract, drop a source file, or choose an archive."
          onChange={(event) => onCode(event.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
        />
      </div>
      )}

      <div className="editor-footer">
        <span className="endpoint">
          powered by{" "}
          <a className="endpoint-link" href="https://savant.chat" target="_blank" rel="noreferrer">
            savant.chat
          </a>{" "}
          · price shown before it starts
        </span>
        <div className="footer-actions">
          <span className="shortcut">
            <kbd>{shortcut}</kbd>
            <kbd>Enter</kbd>
          </span>
          <button
            className="btn primary"
            type="button"
            onClick={onSubmit}
            disabled={!archiveLabel && !code.trim()}
            title={archiveLabel || code.trim() ? "Price this contract with Savant" : "Paste a contract or choose an archive"}
          >
            Run audit
          </button>
        </div>
      </div>
    </section>
  );
}
