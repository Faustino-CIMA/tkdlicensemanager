"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EntityTable } from "@/components/club-admin/entity-table";
import { EmptyState } from "@/components/club-admin/empty-state";
import { SummaryCard } from "@/components/club-admin/summary-card";
import { useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import {
  Club,
  License,
  Member,
  getClubs,
  getLicenses,
  getMembers,
} from "@/lib/club-admin-api";
import { getClubInvoices, getClubOrders } from "@/lib/club-finance-api";
import { FinanceInvoice, FinanceOrder } from "@/lib/ltf-finance-api";

type QueueSeverity = "info" | "warning" | "critical";

type QueueItem = {
  id: string;
  label: string;
  count: number;
  severity: QueueSeverity;
  href: string;
};

type RecentActivityRow = {
  id: string;
  typeLabel: string;
  reference: string;
  statusLabel: string;
  totalLabel: string;
  atLabel: string;
  timestamp: number;
  href: string;
};

function getSeverityClasses(severity: QueueSeverity) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function toTimestamp(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export default function ClubAdminOverviewPage() {
  const t = useTranslations("ClubAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const { selectedClubId, setSelectedClubId } = useClubSelection();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [orders, setOrders] = useState<FinanceOrder[]>([]);
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const loadOverview = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMessage(null);
      try {
        const [clubsResponse, membersResponse, licensesResponse] = await Promise.all([
          getClubs(),
          getMembers(),
          getLicenses(),
        ]);
        setClubs(clubsResponse);
        setMembers(membersResponse);
        setLicenses(licensesResponse);

        const effectiveClubId = selectedClubId ?? clubsResponse[0]?.id ?? null;
        if (!selectedClubId && effectiveClubId) {
          setSelectedClubId(effectiveClubId);
        }

        if (effectiveClubId) {
          const [ordersResponse, invoicesResponse] = await Promise.all([
            getClubOrders(effectiveClubId),
            getClubInvoices(effectiveClubId),
          ]);
          setOrders(ordersResponse);
          setInvoices(invoicesResponse);
        } else {
          setOrders([]);
          setInvoices([]);
        }
        setLastRefreshAt(new Date().toISOString());
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("overviewLoadError"));
      } finally {
        if (silent) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [selectedClubId, setSelectedClubId, t]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const activeClubId = selectedClubId ?? clubs[0]?.id ?? null;

  const filteredMembers = useMemo(() => {
    if (!activeClubId) {
      return members;
    }
    return members.filter((member) => member.club === activeClubId);
  }, [members, activeClubId]);

  const filteredLicenses = useMemo(() => {
    if (!activeClubId) {
      return licenses;
    }
    return licenses.filter((license) => license.club === activeClubId);
  }, [licenses, activeClubId]);

  const activeMembers = useMemo(
    () => filteredMembers.filter((member) => member.is_active),
    [filteredMembers]
  );
  const activeLicenses = useMemo(
    () => filteredLicenses.filter((license) => license.status === "active"),
    [filteredLicenses]
  );
  const pendingLicenses = useMemo(
    () => filteredLicenses.filter((license) => license.status === "pending"),
    [filteredLicenses]
  );
  const expiredLicenses = useMemo(
    () => filteredLicenses.filter((license) => license.status === "expired"),
    [filteredLicenses]
  );
  const revokedLicenses = useMemo(
    () => filteredLicenses.filter((license) => license.status === "revoked"),
    [filteredLicenses]
  );
  const expiringIn30Days = useMemo(() => {
    const today = new Date();
    const inThirtyDays = new Date();
    inThirtyDays.setDate(today.getDate() + 30);
    return filteredLicenses.filter((license) => {
      if (license.status !== "active") {
        return false;
      }
      const endDate = new Date(license.end_date);
      if (Number.isNaN(endDate.getTime())) {
        return false;
      }
      return endDate >= today && endDate <= inThirtyDays;
    }).length;
  }, [filteredLicenses]);

  const membersMissingLtfId = useMemo(
    () =>
      activeMembers.filter(
        (member) => !member.ltf_licenseid || member.ltf_licenseid.trim().length === 0
      ).length,
    [activeMembers]
  );

  const membersWithoutValidLicense = useMemo(() => {
    const licensesByMember = new Map<number, Set<string>>();
    filteredLicenses.forEach((license) => {
      if (!licensesByMember.has(license.member)) {
        licensesByMember.set(license.member, new Set<string>());
      }
      licensesByMember.get(license.member)?.add(license.status);
    });
    return activeMembers.filter((member) => {
      const statuses = licensesByMember.get(member.id);
      if (!statuses) {
        return true;
      }
      return !statuses.has("active") && !statuses.has("pending");
    }).length;
  }, [activeMembers, filteredLicenses]);

  const issuedInvoicesOverdue7d = useMemo(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return invoices.filter((invoice) => {
      if (invoice.status !== "issued") {
        return false;
      }
      const referenceTimestamp = toTimestamp(invoice.issued_at ?? invoice.created_at);
      if (referenceTimestamp === 0) {
        return false;
      }
      return now - referenceTimestamp > sevenDaysMs;
    }).length;
  }, [invoices]);

  const queueItems = useMemo<QueueItem[]>(
    () => [
      {
        id: "members_missing_ltf_id",
        label: t("overviewActionMembersMissingLtfId"),
        count: membersMissingLtfId,
        severity: "info",
        href: `/${locale}/dashboard/club/members`,
      },
      {
        id: "members_without_valid_license",
        label: t("overviewActionMembersWithoutValidLicense"),
        count: membersWithoutValidLicense,
        severity: "critical",
        href: `/${locale}/dashboard/club/members`,
      },
      {
        id: "issued_invoices_overdue_7d",
        label: t("overviewActionIssuedInvoicesOverdue7d"),
        count: issuedInvoicesOverdue7d,
        severity: "warning",
        href: `/${locale}/dashboard/club/invoices`,
      },
    ],
    [issuedInvoicesOverdue7d, locale, membersMissingLtfId, membersWithoutValidLicense, t]
  );

  const visibleQueueItems = queueItems.filter((item) => item.count > 0);
  const invoicesByStatus = useMemo(
    () => ({
      draft: invoices.filter((invoice) => invoice.status === "draft").length,
      issued: invoices.filter((invoice) => invoice.status === "issued").length,
      paid: invoices.filter((invoice) => invoice.status === "paid").length,
      void: invoices.filter((invoice) => invoice.status === "void").length,
    }),
    [invoices]
  );

  const outstandingAmount = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.status === "issued")
        .reduce((total, invoice) => {
          const amount = Number.parseFloat(invoice.total || "0");
          return total + (Number.isFinite(amount) ? amount : 0);
        }, 0),
    [invoices]
  );
  const currency =
    invoices.find((invoice) => invoice.currency)?.currency ||
    orders.find((order) => order.currency)?.currency ||
    "EUR";

  const recentActivityRows = useMemo<RecentActivityRow[]>(() => {
    const orderRows = orders.map((order) => {
      let statusLabel = order.status;
      if (order.status === "draft" || order.status === "pending") {
        statusLabel = t("orderStatusPlaced");
      } else if (order.status === "paid") {
        statusLabel = t("orderStatusDelivered");
      } else if (order.status === "cancelled" || order.status === "refunded") {
        statusLabel = t("orderStatusCancelled");
      }
      return {
        id: `order-${order.id}`,
        typeLabel: t("recentActivityTypeOrder"),
        reference: order.order_number,
        statusLabel,
        totalLabel: `${order.total} ${order.currency}`,
        atLabel: formatDateTime(order.created_at),
        timestamp: toTimestamp(order.created_at),
        href: `/${locale}/dashboard/club/orders/${order.id}`,
      };
    });
    const invoiceRows = invoices.map((invoice) => {
      let statusLabel = invoice.status;
      if (invoice.status === "draft") {
        statusLabel = common("statusDraft");
      } else if (invoice.status === "issued") {
        statusLabel = t("invoiceStatusDue");
      } else if (invoice.status === "paid") {
        statusLabel = common("statusPaid");
      } else if (invoice.status === "void") {
        statusLabel = common("statusVoid");
      }
      const referenceDate = invoice.issued_at ?? invoice.created_at;
      return {
        id: `invoice-${invoice.id}`,
        typeLabel: t("recentActivityTypeInvoice"),
        reference: invoice.invoice_number,
        statusLabel,
        totalLabel: `${invoice.total} ${invoice.currency}`,
        atLabel: formatDateTime(referenceDate),
        timestamp: toTimestamp(referenceDate),
        href: `/${locale}/dashboard/club/invoices/${invoice.id}`,
      };
    });
    return [...orderRows, ...invoiceRows]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 10);
  }, [common, invoices, locale, orders, t]);

  const recentActivityColumns = useMemo(
    () => [
      { key: "typeLabel", header: t("recentActivityTypeLabel") },
      { key: "reference", header: t("recentActivityReferenceLabel") },
      { key: "statusLabel", header: t("recentActivityStatusLabel") },
      { key: "totalLabel", header: t("recentActivityTotalLabel") },
      { key: "atLabel", header: t("recentActivityAtLabel") },
    ],
    [t]
  );

  return (
    <ClubAdminLayout title={t("overviewTitle")} subtitle={t("overviewSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : clubs.length === 0 ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-zinc-500">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadOverview({ silent: true })}
              disabled={isRefreshing}
            >
              {isRefreshing ? t("refreshingAction") : t("refreshAction")}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard title={t("totalMembers")} value={String(filteredMembers.length)} />
            <SummaryCard title={t("activeMembers")} value={String(activeMembers.length)} />
            <SummaryCard title={t("totalLicenses")} value={String(filteredLicenses.length)} />
            <SummaryCard title={t("activeLicenses")} value={String(activeLicenses.length)} />
            <SummaryCard title={t("pendingLicenses")} value={String(pendingLicenses.length)} />
            <SummaryCard title={t("expiringIn30Days")} value={String(expiringIn30Days)} />
            <SummaryCard
              title={t("issuedInvoicesOpen")}
              value={String(invoicesByStatus.issued)}
            />
            <SummaryCard
              title={t("outstandingAmountLabel")}
              value={`${outstandingAmount.toFixed(2)} ${currency}`}
            />
          </section>

          <section className="space-y-3 rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">{t("actionQueueTitle")}</h2>
            {visibleQueueItems.length === 0 ? (
              <p className="text-sm text-zinc-600">{t("actionQueueAllClear")}</p>
            ) : (
              <div className="space-y-2">
                {visibleQueueItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 ${getSeverityClasses(item.severity)}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs opacity-90">
                        {t("actionQueueCountLabel", { count: item.count })}
                      </p>
                    </div>
                    <Link
                      href={item.href}
                      className="rounded-full border border-current px-3 py-1 text-xs font-medium"
                    >
                      {t("openAction")}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-zinc-900">{t("licensesDistributionTitle")}</h2>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <p>
                  {t("activeLicenses")}: <span className="font-semibold">{activeLicenses.length}</span>
                </p>
                <p>
                  {t("pendingLicenses")}: <span className="font-semibold">{pendingLicenses.length}</span>
                </p>
                <p>
                  {t("expiredLicenses")}: <span className="font-semibold">{expiredLicenses.length}</span>
                </p>
                <p>
                  {t("revokedLicenses")}: <span className="font-semibold">{revokedLicenses.length}</span>
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-zinc-900">{t("invoicesDistributionTitle")}</h2>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <p>
                  {t("invoiceStatusDraft")}: <span className="font-semibold">{invoicesByStatus.draft}</span>
                </p>
                <p>
                  {t("invoiceStatusDue")}: <span className="font-semibold">{invoicesByStatus.issued}</span>
                </p>
                <p>
                  {t("invoiceStatusPaid")}: <span className="font-semibold">{invoicesByStatus.paid}</span>
                </p>
                <p>
                  {t("invoiceStatusVoid")}: <span className="font-semibold">{invoicesByStatus.void}</span>
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900">{t("recentActivityTitle")}</h2>
            {recentActivityRows.length === 0 ? (
              <EmptyState title={t("recentActivityTitle")} description={t("recentActivityEmpty")} />
            ) : (
              <EntityTable
                columns={recentActivityColumns}
                rows={recentActivityRows}
                onRowClick={(row) => {
                  router.push(row.href);
                }}
              />
            )}
          </section>
        </div>
      )}
    </ClubAdminLayout>
  );
}
