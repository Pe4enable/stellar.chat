export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  location: string;
  recommendation: string;
};

export type AuditReport = {
  summary: string;
  findings: Finding[];
  text: string;
  raw: string;
};

export type Phase =
  | { name: "edit" }
  | { name: "running"; startedAt: number }
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
