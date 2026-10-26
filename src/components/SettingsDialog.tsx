import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  endpoint: string;
  apiKey: string;
  error: string;
  onEndpoint: (value: string) => void;
  onApiKey: (value: string) => void;
  onClose: () => void;
};

export function SettingsDialog({ open, endpoint, apiKey, error, onEndpoint, onApiKey, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const silentClose = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const closeQuietly = () => {
      if (!dialog.open) return;
      silentClose.current = true;
      dialog.close();
      silentClose.current = false;
    };

    if (open) {
      if (!dialog.open) dialog.showModal();
      inputRef.current?.focus();
    } else {
      closeQuietly();
    }

    return closeQuietly;
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="service-title"
      onClose={() => {
        if (!silentClose.current) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <h2 id="service-title">Audit service</h2>
      <label className="field">
        <span>Endpoint</span>
        <input
          ref={inputRef}
          value={endpoint}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://audit.example.com/v1/audit"
          onChange={(event) => onEndpoint(event.target.value)}
        />
      </label>
      <label className="field">
        <span>API key</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder="Optional"
          onChange={(event) => onApiKey(event.target.value)}
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <p className="hint">
        Run audit sends <code>POST</code> JSON with <code>code</code>, <code>filename</code>, <code>language</code>,
        and <code>chain</code> set to <code>stellar</code>. A finished report is shown as soon as it arrives. A job
        like <code>{`{ "id", "status": "running" }`}</code> is polled with <code>GET {"{url}/{id}"}</code> every 5
        seconds. The optional key is sent as <code>Authorization: Bearer</code> and stored only in this browser.
      </p>
      <p className="hint">
        If the browser blocks the call, put <code>AUDIT_TARGET</code> in <code>.env.local</code> and point this field
        at a path such as <code>/audit-service/v1/audit</code>. The dev server forwards that path.
      </p>
      <div className="row end">
        <button className="btn primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
