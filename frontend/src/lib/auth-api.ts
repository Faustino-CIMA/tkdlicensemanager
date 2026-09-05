import { apiRequest } from "./api";
import type { AuthResponse } from "./auth";

type LoginInput = {
  username: string;
  password: string;
};

type RegisterResponse = {
  detail: string;
};

type ResendVerificationInput = {
  email: string;
  locale?: string;
};

type VerifyEmailInput = {
  key: string;
};

type PasswordResetRequestInput = {
  email: string;
  locale?: string;
};

type PasswordResetConfirmInput = {
  uid: string;
  token: string;
  password: string;
};

export function login(input: LoginInput) {
  const body = new FormData();
  body.append("username", input.username);
  body.append("password", input.password);
  return apiRequest<AuthResponse>("/api/auth/login/", {
    method: "POST",
    body,
  });
}

export async function logout() {
  try {
    await apiRequest("/api/auth/logout/", { method: "POST" });
  } catch {
    // Still drop the local token if the API is unreachable.
  }
}

export function resendVerification(input: ResendVerificationInput) {
  const locale = input.locale ?? "en";
  return apiRequest<RegisterResponse>(
    `/api/auth/resend-verification/?locale=${encodeURIComponent(locale)}`,
    {
      method: "POST",
      body: JSON.stringify({ email: input.email, locale }),
    }
  );
}

export function verifyEmail(input: VerifyEmailInput) {
  return apiRequest<RegisterResponse>("/api/auth/verify-email/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetPasswordRequest(input: PasswordResetRequestInput) {
  const locale = input.locale ?? "en";
  return apiRequest<RegisterResponse>(
    `/api/auth/password-reset/?locale=${encodeURIComponent(locale)}`,
    {
      method: "POST",
      body: JSON.stringify({ email: input.email, locale }),
    }
  );
}

export function resetPasswordConfirm(input: PasswordResetConfirmInput) {
  return apiRequest<RegisterResponse>("/api/auth/password-reset/confirm/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
