export type AuthUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_email_verified: boolean;
  consent_given: boolean;
  consent_given_at: string | null;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

const TOKEN_KEY = "ltf_token";

export function setToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
    window.dispatchEvent(new Event("auth-changed"));
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("auth-changed"));
  }
}
