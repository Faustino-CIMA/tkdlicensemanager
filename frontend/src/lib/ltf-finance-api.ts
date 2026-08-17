import { apiRequest } from "./api";
import { PaginatedResponse, unwrapListResponse } from "./pagination";

type ApiCallOptions = {
  signal?: AbortSignal;
};

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
  stripe_invoice_id?: string | null;
  stripe_customer_id?: string | null;
  issued_at: string | null;
  paid_at: string | null;
  item_quantity?: number;
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
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  item_quantity?: number;
  created_at: string;
  updated_at: string;
  items?: FinanceOrderItem[];
  invoice?: FinanceInvoice | null;
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
  license_type: number;
  amount: string;
  currency: string;
  effective_from: string;
  created_by: number | null;
  created_at: string;
};

export type LicenseTypePolicy = {
  id: number;
  license_type: number;
  allow_current_year_order: boolean;
  current_start_month: number;
  current_start_day: number;
  current_end_month: number;
  current_end_day: number;
  allow_next_year_preorder: boolean;
  next_start_month: number;
  next_start_day: number;
  next_end_month: number;
  next_end_day: number;
  created_at: string;
  updated_at: string;
};

export type FinanceLicenseType = {
  id: number;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
  policy?: LicenseTypePolicy;
};

export type OverviewLink = {
  label_key: string;
  path: string;
};

export type LtfFinanceOverviewResponse = {
  meta: {
    version: "1.0";
    role: "ltf_finance";
    generated_at: string;
    period: {
      today: string;
      month_start: string;
      month_end: string;
      expiring_window_days: number;
    };
  };
  currency: string;
  cards: {
    received_orders: number;
    delivered_orders: number;
    cancelled_orders: number;
    issued_invoices_open: number;
    paid_invoices: number;
    outstanding_amount: string;
    collected_this_month_amount: string;
    pricing_coverage: {
      total_license_types: number;
      with_active_price: number;
      missing_active_price: number;
    };
  };
  action_queue: Array<{
    key:
      | "issued_invoices_overdue_7d"
      | "license_types_without_active_price"
      | "paid_orders_with_pending_licenses"
      | "failed_or_cancelled_payments_30d";
    count: number;
    severity: "info" | "warning" | "critical";
    link: OverviewLink;
  }>;
  distributions: {
    orders_by_status: {
      draft: number;
      pending: number;
      paid: number;
      cancelled: number;
      refunded: number;
    };
    invoices_by_status: {
      draft: number;
      issued: number;
      paid: number;
      void: number;
    };
  };
  recent_activity: Array<{
    id: number;
    created_at: string;
    action: string;
    message: string;
    club_id: number | null;
    order_id: number | null;
    invoice_id: number | null;
  }>;
  links: {
    orders: OverviewLink;
    invoices: OverviewLink;
    payments: OverviewLink;
    license_settings: OverviewLink;
    audit_log: OverviewLink;
  };
};

export type { PaginatedResponse } from "./pagination";

type FinanceOrderQueryParams = {
  q?: string;
  status?: string;
  clubId?: number;
};

type FinanceOrderPageParams = FinanceOrderQueryParams & {
  page: number;
  pageSize: number;
};

function buildFinanceOrderQuery(params?: FinanceOrderQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.clubId) {
    search.set("club_id", String(params.clubId));
  }
  return search;
}

export function getFinanceOrders(options?: ApiCallOptions) {
  return getFinanceOrdersList(undefined, options);
}

export function getFinanceOrdersList(
  params?: FinanceOrderQueryParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceOrderQuery(params);
  const suffix = search.toString();
  return apiRequest<FinanceOrder[] | PaginatedResponse<FinanceOrder>>(
    `/api/orders/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getFinanceOrdersPage(
  params: FinanceOrderPageParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceOrderQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<FinanceOrder>>(
    `/api/orders/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  );
}

export function getFinanceOrder(orderId: number) {
  return apiRequest<FinanceOrder>(`/api/orders/${orderId}/`);
}

export function getFinanceInvoices(options?: ApiCallOptions) {
  return getFinanceInvoicesList(undefined, options);
}

type FinanceInvoiceQueryParams = {
  q?: string;
  status?: string;
  clubId?: number;
};

type FinanceInvoicePageParams = FinanceInvoiceQueryParams & {
  page: number;
  pageSize: number;
};

function buildFinanceInvoiceQuery(params?: FinanceInvoiceQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.clubId) {
    search.set("club_id", String(params.clubId));
  }
  return search;
}

export function getFinanceInvoicesList(
  params?: FinanceInvoiceQueryParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceInvoiceQuery(params);
  const suffix = search.toString();
  return apiRequest<FinanceInvoice[] | PaginatedResponse<FinanceInvoice>>(
    `/api/invoices/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getFinanceInvoicesPage(
  params: FinanceInvoicePageParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceInvoiceQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<FinanceInvoice>>(
    `/api/invoices/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  );
}

export function getFinanceInvoice(invoiceId: number) {
  return apiRequest<FinanceInvoice>(`/api/invoices/${invoiceId}/`);
}

type FinancePaymentQueryParams = {
  invoiceId?: number;
  orderId?: number;
  status?: string;
  q?: string;
};

type FinancePaymentPageParams = FinancePaymentQueryParams & {
  page: number;
  pageSize: number;
};

function buildFinancePaymentQuery(params?: FinancePaymentQueryParams) {
  const search = new URLSearchParams();
  if (params?.invoiceId) {
    search.set("invoice_id", String(params.invoiceId));
  }
  if (params?.orderId) {
    search.set("order_id", String(params.orderId));
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  return search;
}

export function getFinancePayments(
  params?: FinancePaymentQueryParams,
  options?: ApiCallOptions
) {
  const search = buildFinancePaymentQuery(params);
  const suffix = search.toString();
  return apiRequest<Payment[] | PaginatedResponse<Payment>>(
    `/api/payments/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getFinancePaymentsPage(
  params: FinancePaymentPageParams,
  options?: ApiCallOptions
) {
  const search = buildFinancePaymentQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<Payment>>(
    `/api/payments/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  );
}

export function getFinanceClubs(options?: ApiCallOptions) {
  return apiRequest<Club[]>("/api/clubs/", {
    signal: options?.signal,
  });
}

export function getFinanceMembers() {
  return apiRequest<Member[]>("/api/members/");
}

export function getFinanceAuditLogs() {
  return getFinanceAuditLogsList();
}

type FinanceAuditLogQueryParams = {
  q?: string;
};

type FinanceAuditLogPageParams = FinanceAuditLogQueryParams & {
  page: number;
  pageSize: number;
};

function buildFinanceAuditLogQuery(params?: FinanceAuditLogQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  return search;
}

export function getFinanceAuditLogsList(
  params?: FinanceAuditLogQueryParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceAuditLogQuery(params);
  const suffix = search.toString();
  return apiRequest<FinanceAuditLog[] | PaginatedResponse<FinanceAuditLog>>(
    `/api/finance-audit-logs/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  ).then((response) => unwrapListResponse(response));
}

export function getFinanceAuditLogsPage(
  params: FinanceAuditLogPageParams,
  options?: ApiCallOptions
) {
  const search = buildFinanceAuditLogQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<FinanceAuditLog>>(
    `/api/finance-audit-logs/${suffix ? `?${suffix}` : ""}`,
    {
      signal: options?.signal,
    }
  );
}

export function getLtfFinanceOverview(options?: ApiCallOptions) {
  return apiRequest<LtfFinanceOverviewResponse>("/api/dashboard/overview/ltf-finance/", {
    signal: options?.signal,
  });
}

export function getLicensePrices(
  params?: { licenseTypeId?: number },
  options?: ApiCallOptions
) {
  const search = new URLSearchParams();
  if (params?.licenseTypeId) {
    search.set("license_type", String(params.licenseTypeId));
  }
  const suffix = search.toString();
  return apiRequest<LicensePrice[]>(`/api/license-prices/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function createLicensePrice(input: {
  license_type: number;
  amount: string;
  currency?: string;
  effective_from?: string;
}) {
  return apiRequest<LicensePrice>("/api/license-prices/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getFinanceLicenseTypes(options?: ApiCallOptions) {
  return apiRequest<FinanceLicenseType[]>("/api/license-types/", {
    signal: options?.signal,
  });
}

export function createFinanceLicenseType(input: {
  name: string;
  initial_price_amount?: string;
  initial_price_currency?: string;
  initial_price_effective_from?: string;
}) {
  return apiRequest<FinanceLicenseType>("/api/license-types/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFinanceLicenseType(id: number, input: { name: string }) {
  return apiRequest<FinanceLicenseType>(`/api/license-types/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteFinanceLicenseType(id: number) {
  return apiRequest<void>(`/api/license-types/${id}/`, {
    method: "DELETE",
  });
}

export function getFinanceLicenseTypePolicy(licenseTypeId: number) {
  return apiRequest<LicenseTypePolicy>(`/api/license-types/${licenseTypeId}/policy/`);
}

export function updateFinanceLicenseTypePolicy(
  licenseTypeId: number,
  input: Partial<Omit<LicenseTypePolicy, "id" | "license_type" | "created_at" | "updated_at">>
) {
  return apiRequest<LicenseTypePolicy>(`/api/license-types/${licenseTypeId}/policy/`, {
    method: "PATCH",
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
