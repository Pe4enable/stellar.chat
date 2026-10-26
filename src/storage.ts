const KEYS = {
  code: "stellar-audit:code",
  filename: "stellar-audit:filename",
  active: "stellar-audit:active",
} as const;

export function readLocal(key: "code" | "filename"): string | null {
  try {
    return localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

export function writeLocal(key: "code" | "filename", value: string) {
  try {
    localStorage.setItem(KEYS[key], value);
  } catch {
    /* Private mode or a full disk should not block the audit UI. */
  }
}

export function forgetStoredKey() {
  try {
    localStorage.removeItem("stellar-audit:apiKey");
    localStorage.removeItem("stellar-audit:endpoint");
  } catch {
    /* Nothing to clear. */
  }
}

export type ActiveAudit = {
  auditId: string;
  startedAt: number;
  pollAfterSeconds: number;
  webUrl: string;
};

export function readActiveAudit(): ActiveAudit | null {
  try {
    const raw = sessionStorage.getItem(KEYS.active);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ActiveAudit>;
    if (!data.auditId || !data.startedAt) return null;
    return {
      auditId: data.auditId,
      startedAt: data.startedAt,
      pollAfterSeconds: data.pollAfterSeconds || 15,
      webUrl: data.webUrl || "",
    };
  } catch {
    return null;
  }
}

export function writeActiveAudit(audit: ActiveAudit) {
  try {
    sessionStorage.setItem(KEYS.active, JSON.stringify(audit));
  } catch {
    /* The page can still follow the audit until it is reloaded. */
  }
}

export function clearActiveAudit() {
  try {
    sessionStorage.removeItem(KEYS.active);
  } catch {
    /* Already gone. */
  }
}
