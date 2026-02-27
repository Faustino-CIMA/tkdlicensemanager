import { apiRequest } from "./api";
import { PaginatedResponse, unwrapListResponse } from "./pagination";

type ApiCallOptions = {
  signal?: AbortSignal;
};

export type CardElementType = "text" | "image" | "shape" | "qr" | "barcode";

export type CardDesignElement = {
  id: string;
  type: CardElementType;
  x_mm: number | string;
  y_mm: number | string;
  width_mm: number | string;
  height_mm: number | string;
  text?: string;
  merge_field?: string;
  source?: string;
  rotation_deg?: number | string;
  opacity?: number | string;
  z_index?: number | string;
  style?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CardDesignPayload = {
  elements: CardDesignElement[];
  metadata?: Record<string, unknown>;
  background?: Record<string, unknown>;
};

export type CardFormat = {
  id: number;
  code: string;
  name: string;
  description: string;
  width_mm: number | string;
  height_mm: number | string;
  is_custom: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CardFormatInput = {
  code: string;
  name: string;
  description?: string;
  width_mm: number | string;
  height_mm: number | string;
  is_custom?: boolean;
  is_active?: boolean;
};

export type PaperProfile = {
  id: number;
  code: string;
  name: string;
  description: string;
  card_format: number;
  sheet_width_mm: number | string;
  sheet_height_mm: number | string;
  card_width_mm: number | string;
  card_height_mm: number | string;
  margin_top_mm: number | string;
  margin_bottom_mm: number | string;
  margin_left_mm: number | string;
  margin_right_mm: number | string;
  horizontal_gap_mm: number | string;
  vertical_gap_mm: number | string;
  columns: number;
  rows: number;
  slot_count: number;
  is_preset: boolean;
  is_active: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type PaperProfileInput = {
  code: string;
  name: string;
  description?: string;
  card_format: number;
  sheet_width_mm: number | string;
  sheet_height_mm: number | string;
  card_width_mm: number | string;
  card_height_mm: number | string;
  margin_top_mm: number | string;
  margin_bottom_mm: number | string;
  margin_left_mm: number | string;
  margin_right_mm: number | string;
  horizontal_gap_mm: number | string;
  vertical_gap_mm: number | string;
  columns: number;
  rows: number;
  slot_count: number;
  is_preset?: boolean;
  is_active?: boolean;
};

export type CardTemplateVersionSummary = {
  id: number;
  version_number: number;
  label: string;
  status: "draft" | "published";
  published_at: string | null;
  card_format: number;
  paper_profile: number | null;
};

export type CardTemplate = {
  id: number;
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
  latest_published_version: CardTemplateVersionSummary | null;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type CardTemplateInput = {
  name: string;
  description?: string;
  is_default?: boolean;
  is_active?: boolean;
};

export type CardTemplateCloneInput = {
  name: string;
  description?: string;
  source_version_id?: number;
};

export type CardTemplateVersion = {
  id: number;
  template: number;
  version_number: number;
  label: string;
  status: "draft" | "published";
  card_format: number;
  paper_profile: number | null;
  design_payload: CardDesignPayload;
  notes: string;
  created_by: number | null;
  published_by: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CardTemplateVersionInput = {
  template: number;
  label?: string;
  card_format: number;
  paper_profile?: number | null;
  design_payload?: CardDesignPayload;
  notes?: string;
};

export type CardTemplateVersionPatchInput = {
  label?: string;
  card_format?: number;
  paper_profile?: number | null;
  design_payload?: CardDesignPayload;
  notes?: string;
};

export type MergeField = {
  key: string;
  label: string;
  description: string;
};

export type PrintJobStatus =
  | "draft"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PrintJobItemStatus = "pending" | "printed" | "failed";

export type PrintJobItem = {
  id: number;
  member: number | null;
  license: number | null;
  quantity: number;
  slot_index: number | null;
  status: PrintJobItemStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PrintJob = {
  id: number;
  job_number: string;
  club: number;
  template_version: number;
  paper_profile: number | null;
  status: PrintJobStatus;
  total_items: number;
  metadata: Record<string, unknown>;
  requested_by: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  items: PrintJobItem[];
};

export type PrintJobInput = {
  club: number;
  template_version: number;
  paper_profile?: number | null;
  total_items?: number;
  metadata?: Record<string, unknown>;
};

type CardTemplateVersionListQuery = {
  templateId?: number;
};

function buildTemplateVersionQuery(params?: CardTemplateVersionListQuery) {
  const search = new URLSearchParams();
  if (typeof params?.templateId === "number") {
    search.set("template_id", String(params.templateId));
  }
  return search;
}

export function getCardFormats(options?: ApiCallOptions) {
  return apiRequest<CardFormat[] | PaginatedResponse<CardFormat>>("/api/card-formats/", {
    signal: options?.signal,
  }).then((response) => unwrapListResponse(response));
}

export function getCardFormat(id: number, options?: ApiCallOptions) {
  return apiRequest<CardFormat>(`/api/card-formats/${id}/`, {
    signal: options?.signal,
  });
}

export function createCardFormat(input: CardFormatInput) {
  return apiRequest<CardFormat>("/api/card-formats/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCardFormat(id: number, input: Partial<CardFormatInput>) {
  return apiRequest<CardFormat>(`/api/card-formats/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCardFormat(id: number) {
  return apiRequest<void>(`/api/card-formats/${id}/`, {
    method: "DELETE",
  });
}

export function getPaperProfiles(options?: ApiCallOptions) {
  return apiRequest<PaperProfile[] | PaginatedResponse<PaperProfile>>("/api/paper-profiles/", {
    signal: options?.signal,
  }).then((response) => unwrapListResponse(response));
}

export function getPaperProfile(id: number, options?: ApiCallOptions) {
  return apiRequest<PaperProfile>(`/api/paper-profiles/${id}/`, {
    signal: options?.signal,
  });
}

export function createPaperProfile(input: PaperProfileInput) {
  return apiRequest<PaperProfile>("/api/paper-profiles/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePaperProfile(id: number, input: Partial<PaperProfileInput>) {
  return apiRequest<PaperProfile>(`/api/paper-profiles/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePaperProfile(id: number) {
  return apiRequest<void>(`/api/paper-profiles/${id}/`, {
    method: "DELETE",
  });
}

export function getCardTemplates(options?: ApiCallOptions) {
  return apiRequest<CardTemplate[] | PaginatedResponse<CardTemplate>>("/api/card-templates/", {
    signal: options?.signal,
  }).then((response) => unwrapListResponse(response));
}

export function getCardTemplate(id: number, options?: ApiCallOptions) {
  return apiRequest<CardTemplate>(`/api/card-templates/${id}/`, {
    signal: options?.signal,
  });
}

export function createCardTemplate(input: CardTemplateInput) {
  return apiRequest<CardTemplate>("/api/card-templates/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCardTemplate(id: number, input: Partial<CardTemplateInput>) {
  return apiRequest<CardTemplate>(`/api/card-templates/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCardTemplate(id: number) {
  return apiRequest<void>(`/api/card-templates/${id}/`, {
    method: "DELETE",
  });
}

export function setDefaultCardTemplate(id: number) {
  return apiRequest<CardTemplate>(`/api/card-templates/${id}/set-default/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function cloneCardTemplate(id: number, input: CardTemplateCloneInput) {
  return apiRequest<CardTemplate>(`/api/card-templates/${id}/clone/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCardTemplateVersions(params?: CardTemplateVersionListQuery, options?: ApiCallOptions) {
  const search = buildTemplateVersionQuery(params);
  const suffix = search.toString();
  return apiRequest<CardTemplateVersion[] | PaginatedResponse<CardTemplateVersion>>(
    `/api/card-template-versions/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getCardTemplateVersion(id: number, options?: ApiCallOptions) {
  return apiRequest<CardTemplateVersion>(`/api/card-template-versions/${id}/`, {
    signal: options?.signal,
  });
}

export function createCardTemplateVersion(input: CardTemplateVersionInput) {
  return apiRequest<CardTemplateVersion>("/api/card-template-versions/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCardTemplateVersion(id: number, input: CardTemplateVersionPatchInput) {
  return apiRequest<CardTemplateVersion>(`/api/card-template-versions/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCardTemplateVersion(id: number) {
  return apiRequest<void>(`/api/card-template-versions/${id}/`, {
    method: "DELETE",
  });
}

export function publishCardTemplateVersion(id: number) {
  return apiRequest<CardTemplateVersion>(`/api/card-template-versions/${id}/publish/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getMergeFields(options?: ApiCallOptions) {
  return apiRequest<MergeField[]>("/api/merge-fields/", {
    signal: options?.signal,
  });
}

export function getPrintJobs(options?: ApiCallOptions) {
  return apiRequest<PrintJob[] | PaginatedResponse<PrintJob>>("/api/print-jobs/", {
    signal: options?.signal,
  }).then((response) => unwrapListResponse(response));
}

export function getPrintJob(id: number, options?: ApiCallOptions) {
  return apiRequest<PrintJob>(`/api/print-jobs/${id}/`, {
    signal: options?.signal,
  });
}

export function createPrintJob(input: PrintJobInput) {
  return apiRequest<PrintJob>("/api/print-jobs/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
