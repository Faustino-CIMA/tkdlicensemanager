import { getToken } from "./auth";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const DEFAULT_API_URL = "http://localhost:8000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function resolveApiUrl(configuredUrl?: string): string {
  const fallback = configuredUrl?.trim() || DEFAULT_API_URL;
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const parsed = new URL(fallback);
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      return fallback;
    }
    const protocol = parsed.protocol || window.location.protocol;
    const runtimeHost = window.location.hostname;
    const port = parsed.port || "8000";
    return `${protocol}//${runtimeHost}:${port}`;
  } catch {
    return fallback;
  }
}

const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL);
export { API_URL };

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const requestUrl = `${API_URL}${path}`;
  const isFormDataRequest =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const skipAuthHeader =
    path.startsWith("/api/auth/login/") ||
    path.startsWith("/api/auth/register/") ||
    path.startsWith("/api/auth/verify-email/") ||
    path.startsWith("/api/auth/resend-verification/") ||
    path.startsWith("/api/auth/password-reset/");
  const defaultHeaders: Record<string, string> = {
    ...(token && !skipAuthHeader ? { Authorization: `Token ${token}` } : {}),
  };
  if (!isFormDataRequest) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const message = await response.text();
    let normalizedMessage = message;
    if (contentType?.includes("text/html")) {
      normalizedMessage = "Request failed. Please try again.";
    }
    if (contentType?.includes("application/json") && message) {
      try {
        const parsed = JSON.parse(message) as {
          non_field_errors?: string[];
          detail?: string;
          message?: string;
          error?: string;
        };
        if (Array.isArray(parsed?.non_field_errors) && parsed.non_field_errors.length > 0) {
          normalizedMessage = parsed.non_field_errors.join(" ");
        } else if (typeof parsed?.detail === "string") {
          normalizedMessage = parsed.detail;
        } else if (typeof parsed?.message === "string") {
          normalizedMessage = parsed.message;
        } else if (typeof parsed?.error === "string") {
          normalizedMessage = parsed.error;
        }
      } catch {
        normalizedMessage = message;
      }
    }
    throw new Error(normalizedMessage || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }
  return (await response.json()) as T;
}
