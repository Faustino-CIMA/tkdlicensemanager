import { API_URL, apiRequest } from "./api";
import { getToken } from "./auth";
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
  club_name?: string;
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
  club_name?: string;
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
  invoice_number?: string;
  order: number;
  order_number?: string;
  club?: number;
  club_name?: string;
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
    other_income_this_year: string;
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
    club_name: string | null;
    order_id: number | null;
    order_number: string | null;
    invoice_id: number | null;
    invoice_number: string | null;
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
  issue?: string;
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
  if (params?.issue) {
    search.set("issue", params.issue);
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
  issue?: string;
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
  if (params?.issue) {
    search.set("issue", params.issue);
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

export type FinanceInvoiceTotals = {
  outstanding_amount: string;
  currency: string;
};

export function getFinanceInvoiceTotals(
  params?: Pick<FinanceInvoiceQueryParams, "q" | "clubId">,
  options?: ApiCallOptions
) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.clubId) {
    search.set("club_id", String(params.clubId));
  }
  const suffix = search.toString();
  return apiRequest<FinanceInvoiceTotals>(`/api/invoices/totals/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

type FinancePaymentQueryParams = {
  invoiceId?: number;
  orderId?: number;
  clubId?: number;
  status?: string;
  q?: string;
  issue?: string;
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
  if (params?.clubId) {
    search.set("club_id", String(params.clubId));
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.issue) {
    search.set("issue", params.issue);
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

export type ExpenseCategory = {
  id: number;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FinanceExpense = {
  id: number;
  expense_number: string;
  category: number;
  category_name: string;
  category_code: string;
  club: number | null;
  club_name: string | null;
  description: string;
  payee: string;
  amount: string;
  currency: string;
  expense_date: string;
  due_date: string | null;
  paid_at: string | null;
  status: "recorded" | "paid" | "void";
  payment_method: string;
  reference: string;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type FinanceReportAmountRow = {
  club_id?: number;
  club_name?: string;
  category_id?: number;
  category_code?: string;
  category_name?: string;
  amount: string;
};

export type FinanceReportResponse = {
  organization_name: string;
  currency: string;
  year: number;
  period_start: string;
  as_of: string;
  generated_at: string;
  methodology: string;
  opening: {
    cash: string;
    is_manual: boolean;
    notes: string;
  };
  income_statement: {
    revenue_license_fees: string;
    other_income: string;
    expenses_total: string;
    surplus: string;
    income_by_club: FinanceReportAmountRow[];
    other_income_by_category: FinanceReportAmountRow[];
    expenses_by_category: FinanceReportAmountRow[];
  };
  cash_movement: {
    opening_cash: string;
    receipts: string;
    other_income: string;
    disbursements: string;
    closing_cash: string;
  };
  balance_sheet: {
    assets: { cash: string; accounts_receivable: string; total: string };
    liabilities: { accounts_payable: string; total: string };
    equity: { net_assets: string; total: string };
    liabilities_and_equity_total: string;
  };
  registers: {
    other_income: Array<{
      id: number;
      income_number: string;
      income_date: string;
      category_name: string;
      payer: string;
      description: string;
      amount: string;
      status: string;
      reference: string;
    }>;
    expenses: Array<{
      id: number;
      expense_number: string;
      expense_date: string;
      category_name: string;
      payee: string;
      description: string;
      amount: string;
      status: string;
      club_name: string;
      paid_at: string | null;
      reference: string;
    }>;
    receivables: Array<{
      id: number;
      invoice_number: string;
      club_name: string;
      issued_at: string;
      amount: string;
    }>;
    payables: Array<{
      id: number;
      expense_number: string;
      payee: string;
      description: string;
      expense_date: string;
      amount: string;
    }>;
  };
};

export function getExpenseCategories(options?: ApiCallOptions & { activeOnly?: boolean }) {
  const search = new URLSearchParams();
  if (options?.activeOnly) {
    search.set("active", "1");
  }
  const suffix = search.toString();
  return apiRequest<ExpenseCategory[]>(`/api/expense-categories/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function createExpenseCategory(input: { name: string; sort_order?: number }) {
  return apiRequest<ExpenseCategory>("/api/expense-categories/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

type ExpenseQueryParams = {
  q?: string;
  status?: string;
  year?: number;
  category?: number;
};

type ExpensePageParams = ExpenseQueryParams & {
  page: number;
  pageSize: number;
};

function buildExpenseQuery(params?: ExpenseQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.year) {
    search.set("year", String(params.year));
  }
  if (params?.category) {
    search.set("category", String(params.category));
  }
  return search;
}

export function getFinanceExpensesPage(params: ExpensePageParams, options?: ApiCallOptions) {
  const search = buildExpenseQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<FinanceExpense>>(`/api/expenses/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function getFinanceExpense(id: number) {
  return apiRequest<FinanceExpense>(`/api/expenses/${id}/`);
}

export function createFinanceExpense(input: {
  category: number;
  club?: number | null;
  description: string;
  payee?: string;
  amount: string;
  currency?: string;
  expense_date: string;
  due_date?: string;
  payment_method?: string;
  reference?: string;
  notes?: string;
  mark_paid?: boolean;
  paid_at?: string;
}) {
  return apiRequest<FinanceExpense>("/api/expenses/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFinanceExpense(
  id: number,
  input: Partial<{
    category: number;
    club: number | null;
    description: string;
    payee: string;
    amount: string;
    expense_date: string;
    due_date: string | null;
    payment_method: string;
    reference: string;
    notes: string;
  }>
) {
  return apiRequest<FinanceExpense>(`/api/expenses/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function markFinanceExpensePaid(
  id: number,
  input?: { paid_at?: string; payment_method?: string; reference?: string }
) {
  return apiRequest<FinanceExpense>(`/api/expenses/${id}/mark-paid/`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export function voidFinanceExpense(id: number) {
  return apiRequest<FinanceExpense>(`/api/expenses/${id}/void/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type IncomeCategory = {
  id: number;
  name: string;
  code: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FinanceIncome = {
  id: number;
  income_number: string;
  category: number;
  category_name: string;
  category_code: string;
  club: number | null;
  club_name: string | null;
  description: string;
  payer: string;
  amount: string;
  currency: string;
  income_date: string;
  received_at: string | null;
  status: "received" | "void";
  payment_method: string;
  reference: string;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

type IncomeQueryParams = {
  q?: string;
  status?: string;
  year?: number;
  category?: number;
};

type IncomePageParams = IncomeQueryParams & {
  page: number;
  pageSize: number;
};

function buildIncomeQuery(params?: IncomeQueryParams) {
  const search = new URLSearchParams();
  if (params?.q) {
    search.set("q", params.q);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.year) {
    search.set("year", String(params.year));
  }
  if (params?.category) {
    search.set("category", String(params.category));
  }
  return search;
}

export function getIncomeCategories(options?: ApiCallOptions & { activeOnly?: boolean }) {
  const search = new URLSearchParams();
  if (options?.activeOnly) {
    search.set("active", "1");
  }
  const suffix = search.toString();
  return apiRequest<IncomeCategory[]>(`/api/income-categories/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function getFinanceIncomesPage(params: IncomePageParams, options?: ApiCallOptions) {
  const search = buildIncomeQuery(params);
  search.set("page", String(params.page));
  search.set("page_size", String(params.pageSize));
  const suffix = search.toString();
  return apiRequest<PaginatedResponse<FinanceIncome>>(`/api/incomes/${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function getFinanceIncome(id: number) {
  return apiRequest<FinanceIncome>(`/api/incomes/${id}/`);
}

export function createFinanceIncome(input: {
  category: number;
  club?: number | null;
  description: string;
  payer?: string;
  amount: string;
  currency?: string;
  income_date: string;
  payment_method?: string;
  reference?: string;
  notes?: string;
}) {
  return apiRequest<FinanceIncome>("/api/incomes/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFinanceIncome(
  id: number,
  input: Partial<{
    category: number;
    club: number | null;
    description: string;
    payer: string;
    amount: string;
    income_date: string;
    payment_method: string;
    reference: string;
    notes: string;
  }>
) {
  return apiRequest<FinanceIncome>(`/api/incomes/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function voidFinanceIncome(id: number) {
  return apiRequest<FinanceIncome>(`/api/incomes/${id}/void/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getFinanceReport(year: number, options?: ApiCallOptions) {
  return apiRequest<FinanceReportResponse>(`/api/finance-reports/?year=${year}`, {
    signal: options?.signal,
  });
}

export function saveFinanceYearOpening(input: { year: number; opening_cash: string; notes?: string }) {
  return apiRequest<{ year: number; opening_cash: string; notes: string }>("/api/finance-year-openings/", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function downloadFinanceReportExcel(year: number) {
  const token = getToken();
  const response = await fetch(`${API_URL}/api/finance-reports/export/?year=${year}`, {
    headers: {
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error("Failed to download the Excel report.");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `LTF_financial_report_${year}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 10000);
}
