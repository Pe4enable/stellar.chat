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
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return { id: "archive", label: "tar.gz" };
  if (lower.endsWith(".tar")) return { id: "archive", label: "tar" };
  if (lower.endsWith(".zip")) return { id: "archive", label: "zip" };
  const ext = lower.split(".").pop() ?? "";
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

export function isArchiveName(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

export function archiveKind(bytes: Uint8Array): "zip" | "tar" | "gzip" | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "zip";
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length > 262 && String.fromCharCode(...bytes.subarray(257, 262)) === "ustar") return "tar";
  return null;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

