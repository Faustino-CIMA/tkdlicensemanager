import { getToken } from "./auth";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const DEFAULT_API_URL = "http://localhost:8000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function sendAgentLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
) {
  const payload = {
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  console.log(JSON.stringify(payload));
  // #endregion
}

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
    const runtimeHost = window.location.hostname;

    // In deployed environments, a loopback-configured API URL is usually a misconfiguration.
    // Prefer api.<domain> when frontend runs on app.<domain>.
    if (!LOOPBACK_HOSTS.has(runtimeHost)) {
      const runtimeProtocol = window.location.protocol || "https:";
      if (runtimeHost.startsWith("app.")) {
        return `${runtimeProtocol}//${runtimeHost.replace(/^app\./, "api.")}`;
      }
      return `${runtimeProtocol}//${runtimeHost}`;
    }

    const protocol = parsed.protocol || window.location.protocol;
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
  const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const method = options.method ?? "GET";
  sendAgentLog(
    "frontend-login-fetch-v1",
    "H1_H3_H4",
    "frontend/src/lib/api.ts:before-fetch",
    "Preparing API request",
    {
      path,
      requestUrl,
      method,
      runtimeOrigin,
      apiUrl: API_URL,
    }
  );
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
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });
  } catch (error) {
    sendAgentLog(
      "frontend-login-fetch-v1",
      "H1_H2_H4",
      "frontend/src/lib/api.ts:fetch-error",
      "Network error during fetch",
      {
        path,
        requestUrl,
        method,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    );
    throw error;
  }

  if (!response.ok) {
    sendAgentLog(
      "frontend-login-fetch-v1",
      "H3_H4",
      "frontend/src/lib/api.ts:non-ok-response",
      "API response returned non-success status",
      {
        path,
        requestUrl,
        method,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
      }
    );
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
