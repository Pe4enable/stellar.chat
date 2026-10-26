export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function lineCount(code: string): number {
  if (!code) return 0;
  return code.split("\n").length;
}

export function languageFromFilename(filename: string): { id: string; label: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "rs":
      return { id: "rust", label: "Rust · Soroban" };
    case "sol":
      return { id: "solidity", label: "Solidity" };
    case "cairo":
      return { id: "cairo", label: "Cairo" };
    case "move":
      return { id: "move", label: "Move" };
    default:
      return { id: "text", label: "Source" };
  }
}

export function endpointLabel(endpoint: string): string {
  const value = endpoint.trim();
  if (!value) return "Set audit endpoint";
  try {
    const url = new URL(value);
    return url.host + url.pathname;
  } catch {
    return value;
  }
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
