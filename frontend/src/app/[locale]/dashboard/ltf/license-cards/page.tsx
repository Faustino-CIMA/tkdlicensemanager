"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/api";
import { formatDisplayDateTime } from "@/lib/date-display";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import {
  CardTemplate,
  cloneCardTemplate,
  createCardTemplate,
  getCardTemplates,
  setDefaultCardTemplate,
} from "@/lib/license-card-api";

type AuthMeResponse = {
  role: string;
};

export default function LtfAdminLicenseCardsPage() {
  const t = useTranslations("LtfAdmin");
  const locale = useLocale();
  const router = useRouter();
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<number | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

  const [cloneSourceTemplate, setCloneSourceTemplate] = useState<CardTemplate | null>(null);
  const [cloneTemplateName, setCloneTemplateName] = useState("");
  const [cloneTemplateDescription, setCloneTemplateDescription] = useState("");
  const [isCloningTemplate, setIsCloningTemplate] = useState(false);

  const canManageTemplates = currentRole === "ltf_admin";
  const fallbackRoute = getDashboardRouteForRole(currentRole ?? "", locale) ?? `/${locale}/dashboard`;

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getCardTemplates();
      setTemplates(response);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardsLoadError")
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let isMounted = true;
    const loadRole = async () => {
      setIsRoleLoading(true);
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) {
          setCurrentRole(me.role);
        }
      } catch {
        if (isMounted) {
          setCurrentRole(null);
        }
      } finally {
        if (isMounted) {
          setIsRoleLoading(false);
        }
      }
    };
    void loadRole();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!canManageTemplates) {
      return;
    }
    void loadTemplates();
  }, [canManageTemplates, loadTemplates]);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return templates;
    }
    return templates.filter((template) => {
      const latestVersion = template.latest_published_version;
      return (
        template.name.toLowerCase().includes(normalizedQuery) ||
        template.description.toLowerCase().includes(normalizedQuery) ||
        String(latestVersion?.version_number ?? "").includes(normalizedQuery)
      );
    });
  }, [searchQuery, templates]);

  const startCreateTemplate = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setNewTemplateName("");
    setNewTemplateDescription("");
    setIsCreateModalOpen(true);
  };

  const submitCreateTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) {
      setErrorMessage(t("licenseCardsTemplateNameRequired"));
      return;
    }
    setIsCreatingTemplate(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await createCardTemplate({
        name,
        description: newTemplateDescription.trim(),
      });
      setIsCreateModalOpen(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
      setSuccessMessage(t("licenseCardsTemplateCreated"));
      await loadTemplates();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardsTemplateCreateError")
      );
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  const handleSetDefaultTemplate = async (template: CardTemplate) => {
    setBusyTemplateId(template.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await setDefaultCardTemplate(template.id);
      setSuccessMessage(t("licenseCardsTemplateSetDefaultSuccess"));
      await loadTemplates();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardsTemplateSetDefaultError")
      );
    } finally {
      setBusyTemplateId(null);
    }
  };

  const startCloneTemplate = (template: CardTemplate) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setCloneSourceTemplate(template);
    setCloneTemplateName(`${template.name} ${t("licenseCardsCloneNameSuffix")}`);
    setCloneTemplateDescription(template.description || "");
  };

  const submitCloneTemplate = async () => {
    if (!cloneSourceTemplate) {
      return;
    }
    const name = cloneTemplateName.trim();
    if (!name) {
      setErrorMessage(t("licenseCardsTemplateNameRequired"));
      return;
    }
    setIsCloningTemplate(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await cloneCardTemplate(cloneSourceTemplate.id, {
        name,
        description: cloneTemplateDescription.trim(),
      });
      setCloneSourceTemplate(null);
      setCloneTemplateName("");
      setCloneTemplateDescription("");
      setSuccessMessage(t("licenseCardsTemplateCloned"));
      await loadTemplates();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardsTemplateCloneError")
      );
    } finally {
      setIsCloningTemplate(false);
    }
  };

  if (isRoleLoading) {
    return (
      <LtfAdminLayout title={t("licenseCardsTitle")} subtitle={t("licenseCardsSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </LtfAdminLayout>
    );
  }

  if (!canManageTemplates) {
    return (
      <LtfAdminLayout title={t("licenseCardsTitle")} subtitle={t("licenseCardsSubtitle")}>
        <EmptyState
          title={t("licenseCardsAccessDeniedTitle")}
          description={t("licenseCardsAccessDeniedSubtitle")}
        />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={fallbackRoute}>{t("licenseCardsAccessDeniedBackAction")}</Link>
          </Button>
        </div>
      </LtfAdminLayout>
    );
  }

  return (
    <LtfAdminLayout title={t("licenseCardsTitle")} subtitle={t("licenseCardsSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            className="w-full max-w-sm"
            placeholder={t("licenseCardsSearchPlaceholder")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Button onClick={startCreateTemplate}>{t("licenseCardsCreateAction")}</Button>
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : filteredTemplates.length === 0 ? (
          <EmptyState
            title={t("licenseCardsEmptyTitle")}
            description={t("licenseCardsEmptySubtitle")}
          />
        ) : (
          <EntityTable
            columns={[
              { key: "name", header: t("licenseCardsTemplateNameLabel") },
              {
                key: "description",
                header: t("licenseCardsTemplateDescriptionLabel"),
                render: (template: CardTemplate) => template.description || "-",
              },
              {
                key: "latest_published_version",
                header: t("licenseCardsLatestPublishedLabel"),
                render: (template: CardTemplate) => {
                  if (!template.latest_published_version) {
                    return t("licenseCardsNoPublishedVersion");
                  }
                  return t("licenseCardsLatestPublishedVersionSummary", {
                    version: template.latest_published_version.version_number,
                    time: formatDisplayDateTime(template.latest_published_version.published_at),
                  });
                },
              },
              {
                key: "status",
                header: t("statusLabel"),
                render: (template: CardTemplate) => (
                  <div className="flex flex-wrap gap-2">
                    {template.is_default ? (
                      <StatusBadge
                        label={t("licenseCardsStatusDefault")}
                        tone="success"
                      />
                    ) : null}
                    <StatusBadge
                      label={
                        template.is_active
                          ? t("licenseCardsStatusActive")
                          : t("licenseCardsStatusInactive")
                      }
                      tone={template.is_active ? "info" : "neutral"}
                    />
                    <StatusBadge
                      label={
                        template.latest_published_version
                          ? t("licenseCardsStatusHasPublished")
                          : t("licenseCardsStatusNoPublished")
                      }
                      tone={template.latest_published_version ? "success" : "warning"}
                    />
                  </div>
                ),
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (template: CardTemplate) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        router.push(
                          `/${locale}/dashboard/ltf/license-cards/${template.id}/designer`
                        );
                      }}
                    >
                      {t("licenseCardsOpenDesignerAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={template.is_default || busyTemplateId === template.id}
                      onClick={() => {
                        void handleSetDefaultTemplate(template);
                      }}
                    >
                      {template.is_default
                        ? t("licenseCardsStatusDefault")
                        : t("licenseCardsSetDefaultAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyTemplateId === template.id}
                      onClick={() => startCloneTemplate(template)}
                    >
                      {t("licenseCardsCloneAction")}
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={filteredTemplates}
            onRowClick={(template) => {
              router.push(`/${locale}/dashboard/ltf/license-cards/${template.id}/designer`);
            }}
          />
        )}
      </div>

      <Modal
        title={t("licenseCardsCreateModalTitle")}
        description={t("licenseCardsCreateModalSubtitle")}
        isOpen={isCreateModalOpen}
        onClose={() => {
          if (isCreatingTemplate) {
            return;
          }
          setIsCreateModalOpen(false);
        }}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("licenseCardsTemplateNameLabel")}
            </label>
            <Input
              placeholder={t("licenseCardsTemplateNamePlaceholder")}
              value={newTemplateName}
              onChange={(event) => setNewTemplateName(event.target.value)}
              disabled={isCreatingTemplate}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("licenseCardsTemplateDescriptionLabel")}
            </label>
            <textarea
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              placeholder={t("licenseCardsTemplateDescriptionPlaceholder")}
              value={newTemplateDescription}
              onChange={(event) => setNewTemplateDescription(event.target.value)}
              rows={4}
              disabled={isCreatingTemplate}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={isCreatingTemplate} onClick={() => void submitCreateTemplate()}>
              {isCreatingTemplate
                ? t("licenseCardsCreatingTemplateAction")
                : t("licenseCardsCreateAction")}
            </Button>
            <Button
              variant="outline"
              disabled={isCreatingTemplate}
              onClick={() => setIsCreateModalOpen(false)}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        title={t("licenseCardsCloneModalTitle")}
        description={t("licenseCardsCloneModalSubtitle")}
        isOpen={Boolean(cloneSourceTemplate)}
        onClose={() => {
          if (isCloningTemplate) {
            return;
          }
          setCloneSourceTemplate(null);
        }}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("licenseCardsTemplateNameLabel")}
            </label>
            <Input
              placeholder={t("licenseCardsTemplateNamePlaceholder")}
              value={cloneTemplateName}
              onChange={(event) => setCloneTemplateName(event.target.value)}
              disabled={isCloningTemplate}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("licenseCardsTemplateDescriptionLabel")}
            </label>
            <textarea
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              placeholder={t("licenseCardsTemplateDescriptionPlaceholder")}
              value={cloneTemplateDescription}
              onChange={(event) => setCloneTemplateDescription(event.target.value)}
              rows={4}
              disabled={isCloningTemplate}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={isCloningTemplate} onClick={() => void submitCloneTemplate()}>
              {isCloningTemplate
                ? t("licenseCardsCloningTemplateAction")
                : t("licenseCardsCloneAction")}
            </Button>
            <Button
              variant="outline"
              disabled={isCloningTemplate}
              onClick={() => setCloneSourceTemplate(null)}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </div>
      </Modal>
    </LtfAdminLayout>
  );
}
