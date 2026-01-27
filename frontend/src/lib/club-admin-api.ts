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
  date_of_birth: string | null;
  belt_rank: string;
  created_at: string;
  updated_at: string;
};

export type License = {
  id: number;
  member: number;
  club: number;
  year: number;
  start_date: string;
  end_date: string;
  status: "pending" | "active" | "expired";
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberInput = {
  club: number;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  belt_rank?: string;
};

export type LicenseInput = {
  member: number;
  club: number;
  year: number;
  status: "pending" | "active" | "expired";
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

export function getLicenses() {
  return apiRequest<License[]>("/api/licenses/");
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
