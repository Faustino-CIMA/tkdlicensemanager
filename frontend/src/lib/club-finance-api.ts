import { apiRequest } from "./api";
import type { FinanceInvoice, FinanceOrder } from "./ltf-finance-api";

export type CheckoutSession = {
  id: string;
  url: string;
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

export function createClubCheckoutSession(orderId: number) {
  return apiRequest<CheckoutSession>(`/api/club-orders/${orderId}/create-checkout-session/`, {
    method: "POST",
  });
}

type ClubOrderBatchInput = {
  club: number;
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
