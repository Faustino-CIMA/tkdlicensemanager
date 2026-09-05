"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { EntityTable } from "@/components/club-admin/entity-table";
import { OpsLayout } from "@/components/ops/ops-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionNotices, ListToolbarPanel } from "@/components/ui/list-page-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getOpsUsers, runOpsUserAction, type OpsUser } from "@/lib/ops-api";

export default function OpsUsersPage() {
  const t = useTranslations("Ops");
  const locale = useLocale();
  const [users, setUsers] = useState<OpsUser[]>([]);
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    try {
      const page = await getOpsUsers({ q: query || undefined });
      setUsers(page.results);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("loadError"));
    }
  }, [query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (user: OpsUser, action: string) => {
    try {
      await runOpsUserAction(user.id, action, action === "send_password_reset" ? { locale } : undefined);
      setSuccessMessage(t("userActionDone"));
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("saveError"));
    }
  };

  return (
    <OpsLayout title={t("usersTitle")} subtitle={t("usersSubtitle")}>
      <ActionNotices
        error={errorMessage}
        success={successMessage}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
      />
      <ListToolbarPanel
        search={
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchUsers")}
          />
        }
      />
      <div className="mt-4">
        <EntityTable
          columns={[
            { key: "username", header: t("colUser") },
            { key: "email", header: t("colEmail") },
            { key: "role", header: t("colRole") },
            {
              key: "is_active",
              header: t("colActive"),
              render: (row) => (
                <StatusBadge
                  label={row.is_active ? t("yes") : t("no")}
                  tone={row.is_active ? "success" : "danger"}
                />
              ),
            },
            {
              key: "is_superuser",
              header: t("colSuperuser"),
              render: (row) => (row.is_superuser ? t("yes") : t("no")),
            },
            {
              key: "last_login",
              header: t("colLastLogin"),
              render: (row) => (row.last_login ? formatDisplayDateTime(row.last_login) : "—"),
            },
            {
              key: "actions",
              header: t("colActions"),
              render: (row) => (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => act(row, row.is_active ? "disable" : "enable")}>
                    {row.is_active ? t("disable") : t("enable")}
                  </Button>
                  <Button variant="outline" onClick={() => act(row, "revoke_tokens")}>
                    {t("revokeSession")}
                  </Button>
                  <Button variant="outline" onClick={() => act(row, "send_password_reset")}>
                    {t("sendReset")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => act(row, row.is_superuser ? "revoke_superuser" : "grant_superuser")}
                  >
                    {row.is_superuser ? t("revokeSuperuser") : t("grantSuperuser")}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={users}
        />
      </div>
    </OpsLayout>
  );
}
