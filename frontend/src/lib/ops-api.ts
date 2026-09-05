import { API_URL, apiRequest } from "./api";
import { getToken } from "./auth";
import type { PaginatedResponse } from "./pagination";

export type HealthCheck = {
  ok: boolean;
  detail: string;
  [key: string]: unknown;
};

export type OpsHealth = {
  ok: boolean;
  generated_at: string;
  app_version: string;
  django_version: string;
  debug: boolean;
  checks: Record<string, HealthCheck>;
};

export type OpsOverview = {
  generated_at: string;
  online_sessions: number;
  open_alerts: number;
  failed_logins_24h: number;
  user_count: number;
  superuser_count: number;
  health: OpsHealth;
};

export type OpsSession = {
  token_key_suffix: string;
  user_id: number;
  username: string;
  role: string;
  is_superuser: boolean;
  last_used_at: string | null;
  last_ip: string | null;
  user_agent: string;
  created: string | null;
};

export type OpsAuthEvent = {
  id: number;
  event_type: string;
  username_attempted: string;
  username: string;
  user: number | null;
  ip: string | null;
  user_agent: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OpsAlert = {
  id: number;
  severity: "info" | "warning" | "critical";
  code: string;
  title: string;
  detail: string;
  status: "open" | "ack" | "resolved";
  related_user: number | null;
  related_username: string;
  ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type OpsUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  is_email_verified: boolean;
  last_login: string | null;
  date_joined: string;
};

export type OpsQuerySpec = {
  id: string;
  title: string;
  description: string;
  params: Array<{ name: string; type: string; default: string | number | boolean | null }>;
};

export type OpsQueryResult = {
  id: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
};

export type TranslationRow = {
  key: string;
  local_key: string;
  namespace: string;
  section: string;
  section_label: string;
  en: string;
  lb: string;
  en_overridden: boolean;
  lb_overridden: boolean;
  missing_lb: boolean;
  placeholders: string[];
};

export type TranslationPageSummary = {
  id: string;
  title: string;
  description: string;
  preview_path: string | null;
  string_count: number;
  missing_lb: number;
};

export type OpsAuditEntry = {
  id: number;
  actor: number | null;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  message: string;
  ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OpsJobs = {
  generated_at: string;
  celery: Record<string, unknown>;
  stuck_print_jobs: Array<Record<string, unknown>>;
  failed_print_jobs: Array<Record<string, unknown>>;
  billing_schedules: Array<Record<string, unknown>>;
};

export function getOpsOverview() {
  return apiRequest<OpsOverview>("/api/ops/overview/");
}

export function getOpsHealth() {
  return apiRequest<OpsHealth>("/api/ops/health/");
}

export function getOpsSessions(minutes = 15) {
  return apiRequest<{ minutes: number; results: OpsSession[] }>(`/api/ops/sessions/?minutes=${minutes}`);
}

export function revokeOpsSession(userId: number) {
  return apiRequest<{ deleted: number }>(`/api/ops/sessions/${userId}/revoke/`, { method: "POST" });
}

export function getOpsAuthEvents(params: { event_type?: string; page?: number } = {}) {
  const search = new URLSearchParams();
  if (params.event_type) search.set("event_type", params.event_type);
  if (params.page) search.set("page", String(params.page));
  search.set("page_size", "50");
  return apiRequest<PaginatedResponse<OpsAuthEvent>>(`/api/ops/auth-events/?${search.toString()}`);
}

export function getOpsAlerts(params: { status?: string; page?: number } = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.page) search.set("page", String(params.page));
  search.set("page_size", "50");
  return apiRequest<PaginatedResponse<OpsAlert>>(`/api/ops/alerts/?${search.toString()}`);
}

export function updateOpsAlert(id: number, nextStatus: OpsAlert["status"]) {
  return apiRequest<OpsAlert>(`/api/ops/alerts/${id}/`, {
    method: "POST",
    body: JSON.stringify({ status: nextStatus }),
  });
}

export function getOpsUsers(params: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  search.set("page_size", params.page_size || "50");
  return apiRequest<PaginatedResponse<OpsUser>>(`/api/ops/users/?${search.toString()}`);
}

export function runOpsUserAction(userId: number, action: string, extra?: Record<string, string>) {
  return apiRequest<OpsUser>(`/api/ops/users/${userId}/`, {
    method: "POST",
    body: JSON.stringify({ action, ...(extra || {}) }),
  });
}

export function getOpsQueryCatalog() {
  return apiRequest<{ results: OpsQuerySpec[] }>("/api/ops/queries/");
}

export function runOpsQuery(queryId: string, params: Record<string, string | number> = {}) {
  return apiRequest<OpsQueryResult>(`/api/ops/queries/${queryId}/run/`, {
    method: "POST",
    body: JSON.stringify({ params }),
  });
}

export async function downloadOpsQueryCsv(queryId: string, params: Record<string, string | number> = {}) {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/ops/queries/${queryId}/csv/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify({ params }),
  });
  if (!response.ok) {
    throw new Error("CSV export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${queryId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function getOpsTranslations(params: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return apiRequest<{ count: number; namespace?: string; results: TranslationRow[] }>(
    `/api/ops/translations/?${search.toString()}`,
  );
}

export function getOpsTranslationMeta() {
  return apiRequest<{ locales: string[]; pages: TranslationPageSummary[] }>("/api/ops/translations/meta/");
}

export function saveOpsTranslation(locale: "en" | "lb", key: string, value: string) {
  return apiRequest("/api/ops/translations/", {
    method: "POST",
    body: JSON.stringify({ locale, key, value }),
  });
}

export function saveOpsTranslationBatch(
  namespace: string,
  changes: Array<{ locale: "en" | "lb"; key: string; value: string }>,
) {
  return apiRequest<{ saved: number }>("/api/ops/translations/batch/", {
    method: "POST",
    body: JSON.stringify({ namespace, changes }),
  });
}

export async function downloadOpsTranslationExport(locale: "en" | "lb") {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/ops/translations/export/${locale}/`, {
    headers: token ? { Authorization: `Token ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error("Export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${locale}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function getOpsJobs() {
  return apiRequest<OpsJobs>("/api/ops/jobs/");
}

export function retryOpsPrintJob(printJobId: number) {
  return apiRequest(`/api/ops/jobs/print-jobs/${printJobId}/retry/`, { method: "POST" });
}

export function getOpsAudit(params: { page?: number; action?: string } = {}) {
  const search = new URLSearchParams();
  if (params.page) search.set("page", String(params.page));
  if (params.action) search.set("action", params.action);
  search.set("page_size", "50");
  return apiRequest<PaginatedResponse<OpsAuditEntry>>(`/api/ops/audit/?${search.toString()}`);
}

export function getOpsAuditDetail(id: number) {
  return apiRequest<OpsAuditEntry>(`/api/ops/audit/${id}/`);
}
