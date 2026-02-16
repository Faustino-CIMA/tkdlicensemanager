import { apiRequest } from "./api";
import type { FinanceInvoice, FinanceOrder } from "./ltf-finance-api";

export type CheckoutSession = {
  id: string;
  url: string;
};

export type PayconiqPayment = {
  id: number;
  invoice: number;
  order: number;
  amount: string;
  currency: string;
  status: string;
  reference: string;
  payconiq_payment_id: string;
  payconiq_payment_url: string;
  payconiq_status: string;
  created_at: string;
};

export function getClubOrders(clubId?: number | null) {
  const query = clubId ? `?club_id=${encodeURIComponent(String(clubId))}` : "";
  return apiRequest<FinanceOrder[]>(`/api/club-orders/${query}`);
}

export function getClubOrder(orderId: number) {
  return apiRequest<FinanceOrder>(`/api/club-orders/${orderId}/`);
}

export function getClubInvoices(clubId?: number | null) {
  const query = clubId ? `?club_id=${encodeURIComponent(String(clubId))}` : "";
  return apiRequest<FinanceInvoice[]>(`/api/club-invoices/${query}`);
}

export function getClubInvoice(invoiceId: number) {
  return apiRequest<FinanceInvoice>(`/api/club-invoices/${invoiceId}/`);
}

export function createClubCheckoutSession(
  orderId: number,
  payload?: { club_admin_consent_confirmed?: boolean }
) {
  return apiRequest<CheckoutSession>(`/api/club-orders/${orderId}/create-checkout-session/`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export function createPayconiqPayment(invoiceId: number) {
  return apiRequest<PayconiqPayment>("/api/payconiq/create/", {
    method: "POST",
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
}

export function getPayconiqPaymentStatus(paymentId: number) {
  return apiRequest<PayconiqPayment>(`/api/payconiq/${paymentId}/status/`);
}

type ClubOrderBatchInput = {
  club: number;
  license_type?: number;
  member_ids: number[];
  year: number;
  quantity?: number;
  tax_total?: string;
};

export function createClubOrdersBatch(input: ClubOrderBatchInput) {
  return apiRequest<FinanceOrder>("/api/club-orders/batch/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
