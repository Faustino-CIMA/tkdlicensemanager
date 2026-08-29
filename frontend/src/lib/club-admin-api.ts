import { getToken } from "./auth";
import { API_URL, apiRequest } from "./api";
import type { LicenseRoleValue } from "./license-roles";
import { PaginatedResponse, unwrapListResponse } from "./pagination";

export type { LicenseRoleValue } from "./license-roles";

type ApiCallOptions = {
  signal?: AbortSignal;
};

export type Club = {
  id: number;
  name: string;
  city: string;
  address: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  locality: string;
  iban: string;
  bank_name: string;
  email: string;
  max_admins: number;
  created_by: number;
  admins: number[];
  created_at: string;
  updated_at: string;
};

export type LogoUsageType = "general" | "invoice" | "print" | "digital";

export type BrandingLogo = {
  id: number;
  scope_type: "club" | "federation";
  asset_type: "logo" | "document";
  usage_type: LogoUsageType;
  label: string;
  is_selected: boolean;
  file_name: string;
  file_size: number;
  content_url: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandingLogoUploadInput = {
  file: File;
  usage_type?: LogoUsageType;
  label?: string;
  is_selected?: boolean;
};

export type BrandingLogoUpdateInput = {
  usage_type?: LogoUsageType;
  label?: string;
  is_selected?: boolean;
};

export type Member = {
  id: number;
  user: number | null;
  club: number;
  first_name: string;
  last_name: string;
  sex: "M" | "F";
  email: string;
  wt_licenseid: string;
  ltf_licenseid: string;
  date_of_birth: string | null;
  belt_rank: string;
  primary_license_role: LicenseRoleValue | "";
  secondary_license_role: LicenseRoleValue | "";
  profile_picture_url?: string | null;
  profile_picture_thumbnail_url?: string | null;
  photo_edit_metadata?: Record<string, unknown>;
  photo_consent_attested_at?: string | null;
  photo_consent_attested_by?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  current_licenses?: CurrentLicense[];
};

export type CurrentLicense = {
  id: number;
  year: number;
  status: "pending" | "active" | "expired" | "revoked";
  license_type: number;
  license_type_name: string;
};

export type MemberProfilePicture = {
  id: number;
  has_profile_picture: boolean;
  profile_picture_original_url: string | null;
  profile_picture_processed_url: string | null;
  profile_picture_thumbnail_url: string | null;
  photo_edit_metadata: Record<string, unknown>;
  photo_consent_attested_at: string | null;
  photo_consent_attested_by: number | null;
  updated_at: string;
};

export type MemberProfilePictureUploadInput = {
  processedImage: File;
  originalImage?: File;
  photoEditMetadata?: Record<string, unknown>;
  photoConsentConfirmed: boolean;
};

const MAX_PROFILE_PHOTO_REQUEST_BYTES = 8 * 1024 * 1024;

export type License = {
  id: number;
  member: number;
  club: number;
  license_type: number;
  year: number;
  start_date: string;
  end_date: string;
  status: "pending" | "active" | "expired" | "revoked";
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LicenseHistoryEvent = {
  id: number;
  member: number;
  license: number;
  club: number;
  order: number | null;
  payment: number | null;
  actor: number | null;
  event_type:
    | "issued"
    | "renewed"
    | "status_changed"
    | "expired"
    | "revoked"
    | "payment_linked";
  event_at: string;
  reason: string;
  metadata: Record<string, unknown>;
  license_year: number;
  status_before: string;
  status_after: string;
  club_name_snapshot: string;
  license_type_name?: string;
  created_at: string;
};

export type GradeHistoryEntry = {
  id: number;
  member: number;
  club: number;
  examiner_user: number | null;
  from_grade: string;
  to_grade: string;
  promotion_date: string;
  exam_date: string | null;
  proof_ref: string;
  notes: string;
  created_by: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MemberHistoryResponse = {
  member_id: number;
  license_history: LicenseHistoryEvent[];
  grade_history: GradeHistoryEntry[];
};

export type MemberInput = {
  club?: number;
  first_name?: string;
  last_name?: string;
  sex?: "M" | "F";
  email?: string;
  wt_licenseid?: string;
  ltf_licenseid?: string;
  ltf_license_prefix?: "LUX" | "LTF";
  date_of_birth?: string | null;
  belt_rank?: string;
  primary_license_role?: LicenseRoleValue | "";
  secondary_license_role?: LicenseRoleValue | "";
  is_active?: boolean;
};

export type LicenseInput = {
  member: number;
  club: number;
  license_type: number;
  year: number;
  status: "pending" | "active" | "expired";
};

export type LicenseType = {
  id: number;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
};

export type ClubInput = {
  name: string;
  city?: string;
  address?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  locality?: string;
  iban?: string;
  email?: string;
};



export function getClubs() {
  return apiRequest<Club[] | PaginatedResponse<Club>>("/api/clubs/").then(unwrapListResponse);
}

export function updateClub(id: number, input: ClubInput) {
  return apiRequest<Club>(`/api/clubs/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

function buildLogoFormData(input: BrandingLogoUploadInput): FormData {
  const formData = new FormData();
  formData.append("file", input.file);
  if (input.usage_type) {
    formData.append("usage_type", input.usage_type);
  }
  if (input.label) {
    formData.append("label", input.label);
  }
  if (typeof input.is_selected === "boolean") {
    formData.append("is_selected", String(input.is_selected));
  }
  return formData;
}

export function getClubLogos(clubId: number) {
  return apiRequest<{ logos: BrandingLogo[] }>(`/api/clubs/${clubId}/logos/`);
}

export function uploadClubLogo(clubId: number, input: BrandingLogoUploadInput) {
  return apiRequest<BrandingLogo>(`/api/clubs/${clubId}/logos/`, {
    method: "POST",
    body: buildLogoFormData(input),
  });
}

export function updateClubLogo(clubId: number, logoId: number, input: BrandingLogoUpdateInput) {
  return apiRequest<BrandingLogo>(`/api/clubs/${clubId}/logos/${logoId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteClubLogo(clubId: number, logoId: number) {
  return apiRequest<void>(`/api/clubs/${clubId}/logos/${logoId}/`, {
    method: "DELETE",
  });
}

export function deleteClub(id: number) {
  return apiRequest<void>(`/api/clubs/${id}/`, {
    method: "DELETE",
  });
}

export type MemberIssueFilter = "no_valid_license" | "missing_ltf_licenseid";

type MemberListQueryParams = {
  q?: string;
  clubId?: number;
  isActive?: boolean;
  ids?: number[];
  issue?: MemberIssueFilter;
};

type MemberPageParams = MemberListQueryParams & {
  page: number;
  pageSize: number;
};

function buildMemberListQuery(params?: MemberListQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.clubId) {
    search.set("club_id", String(params.clubId));
  }
  if (typeof params?.isActive === "boolean") {
    search.set("is_active", params.isActive ? "true" : "false");
  }
  if (params?.ids && params.ids.length > 0) {
    search.set("ids", params.ids.join(","));
  }
  if (params?.issue) {
    search.set("issue", params.issue);
  }
  return search;
}

export function getMembers(options?: ApiCallOptions) {
  return getMembersList(undefined, options);
}

export function getMembersList(
  params?: MemberListQueryParams,
  options?: ApiCallOptions
) {
  const search = buildMemberListQuery(params);
  const suffix = search.toString();
  return apiRequest<Member[] | PaginatedResponse<Member>>(
    `/api/members/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getMembersPage(
  params: MemberPageParams,
  options?: ApiCallOptions
) {
  const search = buildMemberListQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<Member>>(`/api/members/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function createMember(input: MemberInput) {
  return apiRequest<Member>("/api/members/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getMember(id: number) {
  return apiRequest<Member>(`/api/members/${id}/`);
}

export function updateMember(id: number, input: MemberInput) {
  return apiRequest<Member>(`/api/members/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMember(id: number) {
  return apiRequest<void>(`/api/members/${id}/`, {
    method: "DELETE",
  });
}

export function getMemberLicenseHistory(memberId: number) {
  return apiRequest<LicenseHistoryEvent[]>(`/api/members/${memberId}/license-history/`);
}

export function getMemberGradeHistory(memberId: number) {
  return apiRequest<GradeHistoryEntry[]>(`/api/members/${memberId}/grade-history/`);
}

export function getMemberHistory(memberId: number) {
  return apiRequest<MemberHistoryResponse>(`/api/members/${memberId}/history/`);
}

export function getMemberProfilePicture(memberId: number) {
  return apiRequest<MemberProfilePicture>(`/api/members/${memberId}/profile-picture/`);
}

export function uploadMemberProfilePicture(
  memberId: number,
  input: MemberProfilePictureUploadInput
) {
  const formData = new FormData();
  formData.append("processed_image", input.processedImage);
  const processedSize = Number(input.processedImage.size || 0);
  const originalSize = Number(input.originalImage?.size || 0);
  // Keep multipart payload comfortably below common proxy limits.
  if (
    input.originalImage &&
    processedSize + originalSize <= MAX_PROFILE_PHOTO_REQUEST_BYTES
  ) {
    formData.append("original_image", input.originalImage);
  }
  formData.append("photo_consent_confirmed", String(Boolean(input.photoConsentConfirmed)));
  if (input.photoEditMetadata) {
    formData.append("photo_edit_metadata", JSON.stringify(input.photoEditMetadata));
  }
  return apiRequest<MemberProfilePicture>(`/api/members/${memberId}/profile-picture/`, {
    method: "POST",
    body: formData,
  });
}

export function deleteMemberProfilePicture(memberId: number) {
  return apiRequest<void>(`/api/members/${memberId}/profile-picture/`, {
    method: "DELETE",
  });
}

export async function downloadMemberProfilePicture(memberId: number): Promise<Blob> {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/members/${memberId}/profile-picture/download/`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to download profile picture.");
  }
  return response.blob();
}

export type GradePromotionInput = {
  to_grade: string;
  promotion_date?: string;
  exam_date?: string | null;
  proof_ref?: string;
  notes?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
};

export function promoteMemberGrade(memberId: number, input: GradePromotionInput) {
  return apiRequest<GradeHistoryEntry>(`/api/members/${memberId}/promote-grade/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMemberGrade(
  memberId: number,
  historyId: number,
  input: GradePromotionInput
) {
  return apiRequest<GradeHistoryEntry>(`/api/members/${memberId}/grade-history/${historyId}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteMemberGrade(memberId: number, historyId: number) {
  return apiRequest<void>(`/api/members/${memberId}/grade-history/${historyId}/`, {
    method: "DELETE",
  });
}

type LicenseListQueryParams = {
  q?: string;
  status?: string;
  year?: number;
  memberId?: number;
  memberIds?: number[];
  clubId?: number;
};

type LicensePageParams = LicenseListQueryParams & {
  page: number;
  pageSize: number;
};

function buildLicenseListQuery(params?: LicenseListQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (typeof params?.year === "number") {
    search.set("year", String(params.year));
  }
  if (typeof params?.memberId === "number") {
    search.set("member_id", String(params.memberId));
  }
  if (params?.memberIds && params.memberIds.length > 0) {
    search.set("member_ids", params.memberIds.join(","));
  }
  if (typeof params?.clubId === "number") {
    search.set("club_id", String(params.clubId));
  }
  return search;
}

export function getLicenses(options?: ApiCallOptions) {
  return getLicensesList(undefined, options);
}

export function getLicensesList(
  params?: LicenseListQueryParams,
  options?: ApiCallOptions
) {
  const search = buildLicenseListQuery(params);
  const suffix = search.toString();
  return apiRequest<License[] | PaginatedResponse<License>>(
    `/api/licenses/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getLicensesPage(
  params: LicensePageParams,
  options?: ApiCallOptions
) {
  const search = buildLicenseListQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<License>>(
    `/api/licenses/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  );
}

export function getLicenseTypes() {
  return apiRequest<LicenseType[]>("/api/license-types/");
}

export function createLicense(input: LicenseInput) {
  return apiRequest<License>("/api/licenses/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLicense(id: number, input: LicenseInput) {
  return apiRequest<License>(`/api/licenses/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteLicense(id: number) {
  return apiRequest<void>(`/api/licenses/${id}/`, {
    method: "DELETE",
  });
}

export type TransferClub = {
  id: number;
  name: string;
  locality: string;
  admin_count: number;
};

export type TransferMember = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  club_id: number;
  has_valid_license: boolean;
  pending_transfer: boolean;
  is_club_admin: boolean;
};

export type TransferMessage = {
  id: number;
  author_id: number;
  author_name: string;
  body: string;
  created_at: string;
};

export type MemberTransfer = {
  id: number;
  status: "pending" | "completed" | "rejected" | "cancelled";
  member: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
  from_club: { id: number; name: string };
  to_club: { id: number; name: string };
  initiated_by: { id: number; username: string };
  decided_by: { id: number; username: string } | null;
  fee_amount: string;
  fee_currency: string;
  has_fee: boolean;
  note: string;
  ltf_notified: boolean;
  current_licenses: Array<{
    id: number;
    year: number;
    status: string;
    license_type_name: string;
  }>;
  messages: TransferMessage[];
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function searchTransferMembers(clubId: number, query = "", options?: ApiCallOptions) {
  const search = new URLSearchParams();
  search.set("club_id", String(clubId));
  if (query.trim()) {
    search.set("q", query.trim());
  }
  return apiRequest<{
    members: TransferMember[];
    total: number;
    truncated: boolean;
    limit: number;
  }>(`/api/member-transfers/members/?${search.toString()}`, { signal: options?.signal });
}

export function searchTransferClubs(fromClubId: number, query = "", options?: ApiCallOptions) {
  const search = new URLSearchParams();
  search.set("from_club_id", String(fromClubId));
  if (query.trim()) {
    search.set("q", query.trim());
  }
  return apiRequest<{
    clubs: TransferClub[];
    total: number;
    truncated: boolean;
    limit: number;
  }>(`/api/member-transfers/clubs/?${search.toString()}`, { signal: options?.signal });
}

export function getMemberTransfers(options?: { feeOnly?: boolean; signal?: AbortSignal }) {
  const search = new URLSearchParams();
  if (options?.feeOnly) {
    search.set("fee_only", "true");
  }
  const suffix = search.toString();
  return apiRequest<MemberTransfer[]>(
    `/api/member-transfers/${suffix ? `?${suffix}` : ""}`,
    { signal: options?.signal }
  );
}

export function createMemberTransfer(input: {
  memberId: number;
  toClubId: number;
  fromClubId?: number;
  feeAmount?: string;
  note?: string;
  locale?: string;
}) {
  return apiRequest<MemberTransfer>("/api/member-transfers/", {
    method: "POST",
    body: JSON.stringify({
      member_id: input.memberId,
      to_club_id: input.toClubId,
      from_club_id: input.fromClubId,
      fee_amount: input.feeAmount,
      note: input.note,
      locale: input.locale,
    }),
  });
}

export function acceptMemberTransfer(id: number, locale?: string) {
  return apiRequest<MemberTransfer>(`/api/member-transfers/${id}/accept/`, {
    method: "POST",
    body: JSON.stringify({ locale }),
  });
}

export function rejectMemberTransfer(id: number, locale?: string) {
  return apiRequest<MemberTransfer>(`/api/member-transfers/${id}/reject/`, {
    method: "POST",
    body: JSON.stringify({ locale }),
  });
}

export function cancelMemberTransfer(id: number, locale?: string) {
  return apiRequest<MemberTransfer>(`/api/member-transfers/${id}/cancel/`, {
    method: "POST",
    body: JSON.stringify({ locale }),
  });
}

export function addMemberTransferMessage(id: number, body: string) {
  return apiRequest<MemberTransfer>(`/api/member-transfers/${id}/messages/`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
