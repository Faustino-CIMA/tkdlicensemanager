"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ActionQueue } from "@/components/club-admin/action-queue";
import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EntityTable } from "@/components/club-admin/entity-table";
import { EmptyState } from "@/components/club-admin/empty-state";
import { StatBreakdown } from "@/components/club-admin/stat-breakdown";
import { SummaryCard } from "@/components/club-admin/summary-card";
import {
  AlertTriangle,
  BadgeEuro,
  Clock3,
  IdCard,
  Users,
} from "lucide-react";
import { resolveAssignedClubId, useClubSelection } from "@/components/club-selection-provider";
import { Button } from "@/components/ui/button";
import {
  Club,
  License,
  Member,
  getClubs,
  getLicenses,
  getMemberTransfers,
  getMembers,
} from "@/lib/club-admin-api";
import { getClubInvoices, getClubOrders } from "@/lib/club-finance-api";
import { formatDisplayDateTime } from "@/lib/date-display";
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
  const [incomingTransferCount, setIncomingTransferCount] = useState(0);
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
        const [clubsResponse, membersResponse, licensesResponse, transfersResponse] =
          await Promise.all([
            getClubs(),
            getMembers(),
            getLicenses(),
            getMemberTransfers().catch(() => []),
          ]);
        setClubs(clubsResponse);
        setMembers(membersResponse);
        setLicenses(licensesResponse);
        const administeredIds = new Set(clubsResponse.map((club) => club.id));
        setIncomingTransferCount(
          transfersResponse.filter(
            (item) => item.status === "pending" && administeredIds.has(item.to_club.id)
          ).length
        );

        const effectiveClubId = resolveAssignedClubId(clubsResponse, selectedClubId);
        if (effectiveClubId !== selectedClubId) {
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

  const activeClubId = resolveAssignedClubId(clubs, selectedClubId);

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

  const membersWithoutValidLicenseIds = useMemo(() => {
    const licensesByMember = new Map<number, Set<string>>();
    filteredLicenses.forEach((license) => {
      if (!licensesByMember.has(license.member)) {
        licensesByMember.set(license.member, new Set<string>());
      }
      licensesByMember.get(license.member)?.add(license.status);
    });
    return activeMembers
      .filter((member) => {
        const statuses = licensesByMember.get(member.id);
        if (!statuses) {
          return true;
        }
        return !statuses.has("active") && !statuses.has("pending");
      })
      .map((member) => member.id);
  }, [activeMembers, filteredLicenses]);

  const membersWithoutValidLicense = membersWithoutValidLicenseIds.length;

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
        href: `/${locale}/dashboard/club/members?issue=missing_ltf_licenseid`,
      },
      {
        id: "members_without_valid_license",
        label: t("overviewActionMembersWithoutValidLicense"),
        count: membersWithoutValidLicense,
        severity: "critical",
        href: `/${locale}/dashboard/club/members?issue=no_valid_license`,
      },
      {
        id: "issued_invoices_overdue_7d",
        label: t("overviewActionIssuedInvoicesOverdue7d"),
        count: issuedInvoicesOverdue7d,
        severity: "warning",
        href: `/${locale}/dashboard/club/invoices?issue=overdue_7d`,
      },
      {
        id: "incoming_member_transfers",
        label: t("overviewActionIncomingTransfers"),
        count: incomingTransferCount,
        severity: "warning",
        href: `/${locale}/dashboard/club/transfers?focus=requests#requests`,
      },
    ],
    [
      incomingTransferCount,
      issuedInvoicesOverdue7d,
      locale,
      membersMissingLtfId,
      membersWithoutValidLicense,
      t,
    ]
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
        atLabel: formatDisplayDateTime(order.created_at),
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
        atLabel: formatDisplayDateTime(referenceDate),
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
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      ) : clubs.length === 0 ? (
        <EmptyState title={t("overviewEmptyTitle")} description={t("overviewEmptySubtitle")} />
      ) : (
        <div className="space-y-6">
          <section className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta">
              {lastRefreshAt
                ? t("lastRefreshLabel", { time: formatDisplayDateTime(lastRefreshAt) })
                : t("lastRefreshNever")}
            </p>
            <Button
              variant="outline"
              onClick={() => loadOverview({ silent: true })}
              disabled={isRefreshing}
            >
              {isRefreshing ? t("refreshingAction") : t("refreshAction")}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-4">
            <SummaryCard title={t("totalMembers")} value={String(filteredMembers.length)} icon={Users} tone="accent" />
            <SummaryCard title={t("activeMembers")} value={String(activeMembers.length)} icon={Users} tone="success" />
            <SummaryCard title={t("totalLicenses")} value={String(filteredLicenses.length)} icon={IdCard} tone="accent" />
            <SummaryCard title={t("activeLicenses")} value={String(activeLicenses.length)} icon={IdCard} tone="success" />
            <SummaryCard title={t("pendingLicenses")} value={String(pendingLicenses.length)} icon={Clock3} tone="warning" />
            <SummaryCard title={t("expiringIn30Days")} value={String(expiringIn30Days)} icon={AlertTriangle} tone="warning" />
            <SummaryCard
              title={t("issuedInvoicesOpen")}
              value={String(invoicesByStatus.issued)}
              icon={BadgeEuro}
              tone="warning"
            />
            <SummaryCard
              title={t("outstandingAmountLabel")}
              value={`${outstandingAmount.toFixed(2)} ${currency}`}
              icon={BadgeEuro}
              tone="danger"
            />
          </section>

          <ActionQueue
            title={t("actionQueueTitle")}
            emptyLabel={t("actionQueueAllClear")}
            countLabel={(count) => t("actionQueueCountLabel", { count })}
            openLabel={t("openAction")}
            items={visibleQueueItems}
          />

          <section className="grid gap-4 md:gap-5 xl:grid-cols-2">
            <StatBreakdown
              title={t("licensesDistributionTitle")}
              items={[
                { label: t("activeLicenses"), value: activeLicenses.length, tone: "success" },
                { label: t("pendingLicenses"), value: pendingLicenses.length, tone: "warning" },
                { label: t("expiredLicenses"), value: expiredLicenses.length, tone: "neutral" },
                { label: t("revokedLicenses"), value: revokedLicenses.length, tone: "danger" },
              ]}
            />
            <StatBreakdown
              title={t("invoicesDistributionTitle")}
              items={[
                { label: t("invoiceStatusDraft"), value: invoicesByStatus.draft, tone: "neutral" },
                { label: t("invoiceStatusDue"), value: invoicesByStatus.issued, tone: "warning" },
                { label: t("invoiceStatusPaid"), value: invoicesByStatus.paid, tone: "success" },
                { label: t("invoiceStatusVoid"), value: invoicesByStatus.void, tone: "danger" },
              ]}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">{t("recentActivityTitle")}</h2>
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
