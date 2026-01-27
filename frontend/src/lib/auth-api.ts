import { apiRequest } from "./api";
import type { AuthResponse } from "./auth";

type LoginInput = {
  username: string;
  password: string;
};

type RegisterInput = {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  locale?: string;
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

export function login(input: LoginInput) {
  return apiRequest<AuthResponse>("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function register(input: RegisterInput) {
  const locale = input.locale ?? "en";
  return apiRequest<RegisterResponse>(
    `/api/auth/register/?locale=${encodeURIComponent(locale)}`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, locale }),
    }
  );
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
