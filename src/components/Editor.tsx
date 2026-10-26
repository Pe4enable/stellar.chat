import { useRef, type KeyboardEvent } from "react";
import { endpointLabel, languageFromFilename, lineCount } from "../format";

type Props = {
  code: string;
  filename: string;
  endpoint: string;
  shortcut: string;
  onCode: (value: string) => void;
  onFilename: (value: string) => void;
  onSubmit: () => void;
  onOpenSettings: () => void;
  onLoadExample: () => void;
  onClear: () => void;
  onFile: (file: File) => void;
};

export function Editor({
  code,
  filename,
  endpoint,
  shortcut,
  onCode,
  onFilename,
  onSubmit,
  onOpenSettings,
  onLoadExample,
  onClear,
  onFile,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
        <span className="quiet">{lines} {lines === 1 ? "line" : "lines"}</span>
        <div className="bar-actions">
          <button className="btn small ghost" type="button" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <button className="btn small ghost" type="button" onClick={onLoadExample}>
            Example
          </button>
          <button className="btn small ghost" type="button" onClick={onClear} disabled={!code}>
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
      </div>

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
          placeholder="Paste a Soroban contract, or drop a .rs / .sol file."
          onChange={(event) => onCode(event.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="editor-footer">
        <button
          className={endpoint.trim() ? "endpoint" : "endpoint missing"}
          type="button"
          onClick={onOpenSettings}
        >
          {endpointLabel(endpoint)}
        </button>
        <div className="footer-actions">
          <span className="shortcut">
            <kbd>{shortcut}</kbd>
            <kbd>Enter</kbd>
          </span>
          <button
            className="btn primary"
            type="button"
            onClick={onSubmit}
            disabled={!code.trim()}
            title={code.trim() ? "Send this contract to the audit service" : "Paste a contract first"}
          >
            Run audit
          </button>
        </div>
      </div>
    </section>
  );
}
