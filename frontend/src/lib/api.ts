import { getToken } from "./auth";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const DEFAULT_API_URL = "http://localhost:8000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const API_REQUEST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_REQUEST_TIMEOUT_MS ?? "15000");
const inFlightGetRequests = new Map<string, Promise<unknown>>();

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

function buildRequestSignal(externalSignal?: AbortSignal | null) {
  const hasFiniteTimeout = Number.isFinite(API_REQUEST_TIMEOUT_MS) && API_REQUEST_TIMEOUT_MS > 0;
  if (!hasFiniteTimeout && !externalSignal) {
    return {
      signal: undefined,
      didTimeout: () => false,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  if (hasFiniteTimeout) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, API_REQUEST_TIMEOUT_MS);
  }

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}

async function executeApiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const requestUrl = `${API_URL}${path}`;
  const isFormDataRequest =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const skipAuthHeader =
    path.startsWith("/api/auth/login/") ||
    path.startsWith("/api/auth/verify-email/") ||
    path.startsWith("/api/auth/resend-verification/") ||
    path.startsWith("/api/auth/password-reset/");
  const defaultHeaders: Record<string, string> = {
    ...(token && !skipAuthHeader ? { Authorization: `Token ${token}` } : {}),
  };
  if (!isFormDataRequest) {
    defaultHeaders["Content-Type"] = "application/json";
  }
  const { signal, didTimeout, cleanup } = buildRequestSignal(options.signal);
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      signal,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });
  } catch (error) {
    cleanup();
    if (didTimeout()) {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  }
  cleanup();

  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const message = await response.text();
    let normalizedMessage = message;
    if (contentType?.includes("text/html")) {
      if (response.status === 413) {
        normalizedMessage = "Upload is too large. Please choose a smaller image.";
      } else if (response.status >= 500) {
        normalizedMessage = `Server error (${response.status}). Please try again.`;
      } else {
        normalizedMessage = `Request failed (${response.status}). Please try again.`;
      }
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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const requestUrl = `${API_URL}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const token = getToken() ?? "";
  const shouldDedupeGetRequest = method === "GET" && !options.signal;
  const dedupeKey = shouldDedupeGetRequest ? `${method}:${requestUrl}:${token}` : null;
  if (!dedupeKey) {
    return executeApiRequest<T>(path, options);
  }

  const existingPromise = inFlightGetRequests.get(dedupeKey);
  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const requestPromise = executeApiRequest<T>(path, options).finally(() => {
    inFlightGetRequests.delete(dedupeKey);
  });
  inFlightGetRequests.set(dedupeKey, requestPromise);
  return requestPromise;
}
