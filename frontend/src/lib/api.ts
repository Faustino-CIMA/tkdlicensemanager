import { getToken } from "./auth";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const requestUrl = `${API_URL}${path}`;
  const response = await fetch(requestUrl, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
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
