const KEYS = {
  code: "stellar-audit:code",
  filename: "stellar-audit:filename",
  endpoint: "stellar-audit:endpoint",
  apiKey: "stellar-audit:apiKey",
} as const;

export function readLocal(key: keyof typeof KEYS): string | null {
  try {
    return localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

export function writeLocal(key: keyof typeof KEYS, value: string) {
  try {
    localStorage.setItem(KEYS[key], value);
  } catch {
    /* Private mode or a full disk should not block the audit UI. */
  }
}
