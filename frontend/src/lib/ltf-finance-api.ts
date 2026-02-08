import { apiRequest } from "./api";

export type FinanceOrderItem = {
  id: number;
  license: FinanceLicense;
  price_snapshot: string;
  quantity: number;
};

export type FinanceLicense = {
  id: number;
  member: number;
  club: number;
  license_type: number;
  year: number;
  status: string;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceInvoice = {
  id: number;
  invoice_number: string;
  order: number | null;
  club: number;
  member: number | null;
  status: string;
  currency: string;
  subtotal: string;
  tax_total: string;
  total: string;
  stripe_invoice_id: string | null;
  stripe_customer_id: string | null;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinanceOrder = {
  id: number;
  order_number: string;
  club: number;
  member: number | null;
  status: string;
  currency: string;
  subtotal: string;
  tax_total: string;
  total: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
  updated_at: string;
  items: FinanceOrderItem[];
  invoice: FinanceInvoice | null;
};

export type FinanceAuditLog = {
  id: number;
  action: string;
  message: string;
  metadata: Record<string, unknown> | null;
  actor: number | null;
  club: number | null;
  member: number | null;
  license: number | null;
  order: number | null;
  invoice: number | null;
  created_at: string;
};

export type LicensePrice = {
  id: number;
  amount: string;
  currency: string;
  effective_from: string;
  created_by: number | null;
  created_at: string;
};

export function getFinanceOrders() {
  return apiRequest<FinanceOrder[]>("/api/orders/");
}

export function getFinanceInvoices() {
  return apiRequest<FinanceInvoice[]>("/api/invoices/");
}

export function getFinanceAuditLogs() {
  return apiRequest<FinanceAuditLog[]>("/api/finance-audit-logs/");
}

export function getLicensePrices() {
  return apiRequest<LicensePrice[]>("/api/license-prices/");
}

export function createLicensePrice(input: {
  amount: string;
  currency?: string;
  effective_from?: string;
}) {
  return apiRequest<LicensePrice>("/api/license-prices/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmOrderPayment(
  orderId: number,
  payload: {
    stripe_payment_intent_id?: string;
    stripe_checkout_session_id?: string;
    stripe_invoice_id?: string;
    stripe_customer_id?: string;
  } = {}
) {
  return apiRequest<FinanceOrder>(`/api/orders/${orderId}/confirm-payment/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
