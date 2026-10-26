export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  location: string;
  recommendation: string;
  verdict?: string;
};

export type Quote = {
  tier: string;
  estimatedCost: string;
  fileCount: number;
  tokenCount: number;
  balanceAfter: string;
  limitRemainingAfter: string | null;
  discountPercent: number;
  standardCost: string | null;
};

export type AuditReport = {
  summary: string;
  findings: Finding[];
  text: string;
  raw: string;
  webUrl?: string;
};

export type Phase =
  | { name: "edit" }
  | { name: "preparing"; startedAt: number }
  | { name: "confirm"; startedAt: number; sourceId: string; quotes: Quote[] }
  | { name: "running"; startedAt: number; auditId: string; pollAfterSeconds: number; webUrl: string }
  | { name: "done"; report: AuditReport; elapsedMs: number }
  | { name: "error"; message: string; elapsedMs: number };

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};
