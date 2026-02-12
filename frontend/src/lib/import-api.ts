import { API_URL } from "./api";
import { getToken } from "./auth";

type PreviewResponse = {
  headers: string[];
  sample_rows?: string[][];
  rows?: ImportRow[];
  total_rows: number;
  club_id?: number;
};

type ImportRow = {
  row_index: number;
  data: Record<string, string | null>;
  errors: string[];
  duplicate: boolean;
  existing_id: number | null;
};

type ConfirmResponse = {
  created: number;
  skipped: number;
  errors: Array<{ row_index: number; errors: string[] }>;
  club_id?: number;
};

type ImportType = "clubs" | "members";

export async function previewImport(
  type: ImportType,
  file: File,
  mapping?: Record<string, string>,
  clubId?: number,
  dateFormat?: string
) {
  const formData = new FormData();
  formData.append("file", file);
  if (mapping) {
    formData.append("mapping", JSON.stringify(mapping));
  }
  if (clubId) {
    formData.append("club_id", String(clubId));
  }
  if (dateFormat) {
    formData.append("date_format", dateFormat);
  }

  return upload<PreviewResponse>(`/api/imports/${type}/preview/`, formData);
}

export async function confirmImport(
  type: ImportType,
  file: File,
  mapping: Record<string, string>,
  actions: Array<{ row_index: number; action: "create" | "skip" }>,
  clubId?: number,
  dateFormat?: string
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("mapping", JSON.stringify(mapping));
  formData.append("actions", JSON.stringify(actions));
  if (clubId) {
    formData.append("club_id", String(clubId));
  }
  if (dateFormat) {
    formData.append("date_format", dateFormat);
  }

  return upload<ConfirmResponse>(`/api/imports/${type}/confirm/`, formData);
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Token ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export type { ConfirmResponse, ImportRow, PreviewResponse };
