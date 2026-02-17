import { getToken } from "./auth";
import { API_URL, apiRequest } from "./api";

export type Club = {
  id: number;
  name: string;
  city: string;
  address: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  locality: string;
  max_admins: number;
  created_by: number;
  admins: number[];
  created_at: string;
  updated_at: string;
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
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MemberHistoryResponse = {
  member_id: number;
  license_history: LicenseHistoryEvent[];
  grade_history: GradeHistoryEntry[];
};

export type ClubInput = {
  name: string;
  city?: string;
  address?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  locality?: string;
};

export type MemberInput = {
  club: number;
  first_name: string;
  last_name: string;
  sex: "M" | "F";
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

export type LicenseRoleValue =
  | "athlete"
  | "coach"
  | "referee"
  | "official"
  | "doctor"
  | "physiotherapist";

export type FederationProfile = {
  id: number;
  name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  locality: string;
  created_at: string;
  updated_at: string;
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

export type OverviewLink = {
  label_key: string;
  path: string;
};

export type LtfAdminOverviewResponse = {
  meta: {
    version: "1.0";
    role: "ltf_admin";
    generated_at: string;
    period: {
      today: string;
      month_start: string;
      month_end: string;
      expiring_window_days: number;
    };
  };
  cards: {
    total_clubs: number;
    active_members: number;
    active_licenses: number;
    pending_licenses: number;
    expired_licenses: number;
    revoked_licenses: number;
    expiring_in_30_days: number;
    active_members_without_valid_license: number;
  };
  action_queue: Array<{
    key:
      | "clubs_without_admin"
      | "members_missing_ltf_licenseid"
      | "members_without_active_or_pending_license";
    count: number;
    severity: "info" | "warning" | "critical";
    link: OverviewLink;
  }>;
  distributions: {
    licenses_by_status: {
      active: number;
      pending: number;
      expired: number;
      revoked: number;
    };
  };
  top_clubs: Array<{
    club_id: number;
    club_name: string;
    active_members: number;
    active_licenses: number;
    pending_licenses: number;
  }>;
  links: {
    clubs: OverviewLink;
    members: OverviewLink;
    licenses: OverviewLink;
  };
};

export function getClubs() {
  return apiRequest<Club[]>("/api/clubs/");
}

export function getClub(id: number) {
  return apiRequest<Club>(`/api/clubs/${id}/`);
}

export function getFederationProfile() {
  return apiRequest<FederationProfile>("/api/federation-profile/");
}

export function updateFederationProfile(input: Partial<FederationProfile>) {
  return apiRequest<FederationProfile>("/api/federation-profile/", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createClub(input: ClubInput) {
  return apiRequest<Club>("/api/clubs/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateClub(id: number, input: ClubInput) {
  return apiRequest<Club>(`/api/clubs/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteClub(id: number) {
  return apiRequest<void>(`/api/clubs/${id}/`, {
    method: "DELETE",
  });
}

export type ClubAdmin = {
  id: number;
  username: string;
  email: string;
};

export type EligibleMember = {
  id: number;
  label: string;
  first_name: string;
  last_name: string;
  email: string;
  club_name: string;
};

export function getClubAdmins(clubId: number) {
  return apiRequest<{ admins: ClubAdmin[]; max_admins: number }>(
    `/api/clubs/${clubId}/admins/`
  );
}

export function getEligibleMembers(clubId: number) {
  return apiRequest<{ eligible: EligibleMember[] }>(
    `/api/clubs/${clubId}/eligible_members/`
  );
}

export function addClubAdmin(clubId: number, memberId: number, email?: string, locale?: string) {
  return apiRequest(`/api/clubs/${clubId}/add_admin/`, {
    method: "POST",
    body: JSON.stringify({ member_id: memberId, email, locale }),
  });
}

export function removeClubAdmin(clubId: number, userId: number) {
  return apiRequest(`/api/clubs/${clubId}/remove_admin/`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function setClubMaxAdmins(clubId: number, maxAdmins: number) {
  return apiRequest<{ max_admins: number }>(`/api/clubs/${clubId}/set_max_admins/`, {
    method: "PATCH",
    body: JSON.stringify({ max_admins: maxAdmins }),
  });
}

export function getMembers() {
  return apiRequest<Member[]>("/api/members/");
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
  if (input.originalImage) {
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
  metadata?: Record<string, unknown>;
};

export function promoteMemberGrade(memberId: number, input: GradePromotionInput) {
  return apiRequest<GradeHistoryEntry>(`/api/members/${memberId}/promote-grade/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getLicenses() {
  return apiRequest<License[]>("/api/licenses/");
}

export function getLicenseTypes() {
  return apiRequest<LicenseType[]>("/api/license-types/");
}

export function getLtfAdminOverview() {
  return apiRequest<LtfAdminOverviewResponse>("/api/dashboard/overview/ltf-admin/");
}

export function createLicenseType(input: { name: string }) {
  return apiRequest<LicenseType>("/api/license-types/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLicenseType(id: number, input: { name: string }) {
  return apiRequest<LicenseType>(`/api/license-types/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteLicenseType(id: number) {
  return apiRequest<void>(`/api/license-types/${id}/`, {
    method: "DELETE",
  });
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
