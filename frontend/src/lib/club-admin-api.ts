import { apiRequest } from "./api";

export type Club = {
  id: number;
  name: string;
  city: string;
  address: string;
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

export type MemberInput = {
  club: number;
  first_name: string;
  last_name: string;
  sex: "M" | "F";
  email?: string;
  wt_licenseid?: string;
  ltf_licenseid?: string;
  date_of_birth?: string | null;
  belt_rank?: string;
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
};

export function getClubs() {
  return apiRequest<Club[]>("/api/clubs/");
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
