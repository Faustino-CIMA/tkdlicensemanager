import { apiRequest } from "./api";

export type Club = {
  id: number;
  name: string;
  city: string;
  address: string;
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
  status: "pending" | "active" | "expired";
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClubInput = {
  name: string;
  city?: string;
  address?: string;
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

export function getClubs() {
  return apiRequest<Club[]>("/api/clubs/");
}

export function getClub(id: number) {
  return apiRequest<Club>(`/api/clubs/${id}/`);
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

export function getLicenses() {
  return apiRequest<License[]>("/api/licenses/");
}

export function getLicenseTypes() {
  return apiRequest<LicenseType[]>("/api/license-types/");
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
