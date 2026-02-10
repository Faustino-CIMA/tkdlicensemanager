import { apiRequest } from "./api";

export type FinanceOrderItem = {
  id: number;
  license: FinanceLicense;
  price_snapshot: string;
  quantity: number;
};

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
  sex: "M" | "F";
  email: string;
  wt_licenseid: string;
  ltf_licenseid: string;
  date_of_birth: string | null;
  belt_rank: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

export type Payment = {
  id: number;
  invoice: number;
  order: number;
  amount: string;
  currency: string;
  method: string;
  provider: string;
  status: string;
  reference: string;
  notes: string;
  payconiq_payment_id: string | null;
  payconiq_payment_url: string | null;
  payconiq_status: string | null;
  card_brand: string;
  card_last4: string;
  card_exp_month: number | null;
  card_exp_year: number | null;
  paid_at: string | null;
  created_by: number | null;
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

export function getFinanceOrder(orderId: number) {
  return apiRequest<FinanceOrder>(`/api/orders/${orderId}/`);
}

export function getFinanceInvoices() {
  return apiRequest<FinanceInvoice[]>("/api/invoices/");
}

export function getFinanceInvoice(invoiceId: number) {
  return apiRequest<FinanceInvoice>(`/api/invoices/${invoiceId}/`);
}

export function getFinancePayments(params?: { invoiceId?: number; orderId?: number }) {
  const search = new URLSearchParams();
  if (params?.invoiceId) {
    search.set("invoice_id", String(params.invoiceId));
  }
  if (params?.orderId) {
    search.set("order_id", String(params.orderId));
  }
  const suffix = search.toString();
  return apiRequest<Payment[]>(`/api/payments/${suffix ? `?${suffix}` : ""}`);
}

export function getFinanceClubs() {
  return apiRequest<Club[]>("/api/clubs/");
}

export function getFinanceMembers() {
  return apiRequest<Member[]>("/api/members/");
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
    payment_method?: string;
    payment_provider?: string;
    payment_reference?: string;
    payment_notes?: string;
    paid_at?: string;
    card_brand?: string;
    card_last4?: string;
    card_exp_month?: number;
    card_exp_year?: number;
  } = {}
) {
  return apiRequest<FinanceOrder>(`/api/orders/${orderId}/confirm-payment/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
