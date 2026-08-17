import { API_URL } from "./api";
import { getToken } from "./auth";

type ErrorPayload = {
  detail?: string;
  message?: string;
  error?: string;
};

export async function openInvoicePdf(invoiceId: number) {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/invoices/${invoiceId}/pdf/`, {
    headers: {
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const message = await response.text();
    let normalizedMessage = "Failed to download invoice PDF.";
    if (contentType?.includes("application/json") && message) {
      try {
        const parsed = JSON.parse(message) as ErrorPayload;
        normalizedMessage = parsed.detail || parsed.message || parsed.error || normalizedMessage;
      } catch {
        normalizedMessage = message || normalizedMessage;
      }
    } else if (message) {
      normalizedMessage = message;
    }
    throw new Error(normalizedMessage);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}
