"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { Button } from "@/components/ui/button";
import { ActionNotices, ListActionsRow, ListToolbarPanel } from "@/components/ui/list-page-chrome";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { apiRequest } from "@/lib/api";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import {
  PrinterProfile,
  createPrinterProfile,
  deletePrinterProfile,
  getPrinterProfiles,
  updatePrinterProfile,
} from "@/lib/license-card-api";

type AuthMeResponse = {
  role: string;
};

type PrinterProfileFormValues = {
  name: string;
  x_offset_mm: number;
  y_offset_mm: number;
  description: string;
};

const DEFAULT_FORM_VALUES: PrinterProfileFormValues = {
  name: "",
  x_offset_mm: 0,
  y_offset_mm: 0,
  description: "",
};

function formatOffsetMm(value: number | string): string {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return `${value} mm`;
  }
  return `${parsedValue.toFixed(2)} mm`;
}

export default function ClubAdminPrinterProfilesPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const locale = useLocale();
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [printerProfiles, setPrinterProfiles] = useState<PrinterProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<PrinterProfile | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<PrinterProfile | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const canManagePrinterProfiles = currentRole === "club_admin";
  const fallbackRoute = getDashboardRouteForRole(currentRole ?? "", locale) ?? `/${locale}/dashboard/club`;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PrinterProfileFormValues>({
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const loadPrinterProfiles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getPrinterProfiles();
      setPrinterProfiles(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("printerProfilesLoadError"));
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
    if (!canManagePrinterProfiles) {
      return;
    }
    void loadPrinterProfiles();
  }, [canManagePrinterProfiles, loadPrinterProfiles]);

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return printerProfiles;
    }
    return printerProfiles.filter((profile) => {
      const description = profile.description ?? "";
      return (
        profile.name.toLowerCase().includes(normalizedQuery) ||
        description.toLowerCase().includes(normalizedQuery) ||
        String(profile.x_offset_mm).toLowerCase().includes(normalizedQuery) ||
        String(profile.y_offset_mm).toLowerCase().includes(normalizedQuery)
      );
    });
  }, [printerProfiles, searchQuery]);

  const closeFormModal = () => {
    setEditingProfile(null);
    setIsFormOpen(false);
    reset(DEFAULT_FORM_VALUES);
  };

  const closeDeleteModal = () => {
    setProfileToDelete(null);
    setIsDeleteOpen(false);
  };

  const startCreate = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setEditingProfile(null);
    setIsFormOpen(true);
    reset(DEFAULT_FORM_VALUES);
  };

  const startEdit = (profile: PrinterProfile) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const xOffset = Number(profile.x_offset_mm);
    const yOffset = Number(profile.y_offset_mm);
    setEditingProfile(profile);
    setIsFormOpen(true);
    reset({
      name: profile.name,
      x_offset_mm: Number.isFinite(xOffset) ? xOffset : 0,
      y_offset_mm: Number.isFinite(yOffset) ? yOffset : 0,
      description: profile.description ?? "",
    });
  };

  const startDelete = (profile: PrinterProfile) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setProfileToDelete(profile);
    setIsDeleteOpen(true);
  };

  const onSubmit = async (values: PrinterProfileFormValues) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const normalizedDescription = values.description.trim();
    const payload = {
      name: values.name.trim(),
      x_offset_mm: values.x_offset_mm,
      y_offset_mm: values.y_offset_mm,
      description: normalizedDescription,
    };

    try {
      if (editingProfile) {
        await updatePrinterProfile(editingProfile.id, payload);
        setSuccessMessage(t("printerProfilesUpdatedSuccess"));
      } else {
        await createPrinterProfile(payload);
        setSuccessMessage(t("printerProfilesCreatedSuccess"));
      }
      closeFormModal();
      await loadPrinterProfiles();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("printerProfilesSaveError"));
    }
  };

  const confirmDelete = async () => {
    if (!profileToDelete) {
      return;
    }
    setErrorMessage(null);
    try {
      await deletePrinterProfile(profileToDelete.id);
      closeDeleteModal();
      setSuccessMessage(t("printerProfilesDeletedSuccess"));
      await loadPrinterProfiles();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("printerProfilesDeleteError"));
    }
  };

  if (isRoleLoading) {
    return (
      <ClubAdminLayout title={t("printerProfilesTitle")} subtitle={t("printerProfilesSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
      </ClubAdminLayout>
    );
  }

  if (!canManagePrinterProfiles) {
    return (
      <ClubAdminLayout title={t("printerProfilesTitle")} subtitle={t("printerProfilesSubtitle")}>
        <EmptyState
          title={t("printerProfilesAccessDeniedTitle")}
          description={t("printerProfilesAccessDeniedSubtitle")}
        />
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link href={fallbackRoute}>{t("printerProfilesAccessDeniedBackAction")}</Link>
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("printerProfilesTitle")} subtitle={t("printerProfilesSubtitle")}>
      <ActionNotices error={errorMessage} success={successMessage} onDismiss={() => { setErrorMessage(null); setSuccessMessage(null); }} />

      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <ListToolbarPanel
            search={
              <Input
                className="w-full min-w-0 max-w-xl"
                placeholder={t("printerProfilesSearchPlaceholder")}
                aria-label={t("printerProfilesSearchPlaceholder")}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            }
          />
          <ListActionsRow
            actions={<Button variant="primary" onClick={startCreate}>{t("printerProfilesCreateAction")}</Button>}
          />
        </div>

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} loading />
        ) : filteredProfiles.length === 0 ? (
          <EmptyState
            title={searchQuery.trim() ? t("noResultsTitle") : t("printerProfilesEmptyTitle")}
            description={
              searchQuery.trim()
                ? t("printerProfilesNoResultsSubtitle")
                : t("printerProfilesEmptySubtitle")
            }
          />
        ) : (
          <EntityTable
            columns={[
              { key: "name", header: t("printerProfilesNameLabel") },
              {
                key: "x_offset_mm",
                header: t("printerProfilesXOffsetLabel"),
                render: (profile: PrinterProfile) => formatOffsetMm(profile.x_offset_mm),
              },
              {
                key: "y_offset_mm",
                header: t("printerProfilesYOffsetLabel"),
                render: (profile: PrinterProfile) => formatOffsetMm(profile.y_offset_mm),
              },
              {
                key: "description",
                header: t("printerProfilesDescriptionLabel"),
                render: (profile: PrinterProfile) => profile.description || t("printerProfilesDescriptionEmpty"),
              },
              {
                key: "actions",
                header: t("actionsLabel"),
                render: (profile: PrinterProfile) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("editAction")}
                      onClick={() => startEdit(profile)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={t("deleteAction")}
                      onClick={() => startDelete(profile)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={filteredProfiles}
          />
        )}
      </div>

      <Modal
        title={editingProfile ? t("printerProfilesEditModalTitle") : t("printerProfilesCreateModalTitle")}
        description={t("printerProfilesFormSubtitle")}
        isOpen={isFormOpen}
        onClose={closeFormModal}
      >
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("printerProfilesNameLabel")}</label>
            <Input
              placeholder={t("printerProfilesNamePlaceholder")}
              {...register("name", {
                validate: (value) => value.trim().length > 0 || t("printerProfilesNameRequiredError"),
              })}
            />
            {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t("printerProfilesXOffsetLabel")}
              </label>
              <Input
                type="number"
                step="0.1"
                placeholder={t("printerProfilesOffsetPlaceholder")}
                {...register("x_offset_mm", {
                  valueAsNumber: true,
                  validate: (value) =>
                    Number.isFinite(value) || t("printerProfilesOffsetRequiredError"),
                })}
              />
              {errors.x_offset_mm ? (
                <p className="text-sm text-destructive">{errors.x_offset_mm.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t("printerProfilesYOffsetLabel")}
              </label>
              <Input
                type="number"
                step="0.1"
                placeholder={t("printerProfilesOffsetPlaceholder")}
                {...register("y_offset_mm", {
                  valueAsNumber: true,
                  validate: (value) =>
                    Number.isFinite(value) || t("printerProfilesOffsetRequiredError"),
                })}
              />
              {errors.y_offset_mm ? (
                <p className="text-sm text-destructive">{errors.y_offset_mm.message}</p>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-muted">{t("printerProfilesOffsetHelpText")}</p>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("printerProfilesDescriptionLabel")}
            </label>
            <textarea
              className="w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-foreground"
              rows={4}
              placeholder={t("printerProfilesDescriptionPlaceholder")}
              {...register("description")}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("printerProfilesSavingAction")
                : editingProfile
                  ? t("printerProfilesUpdateAction")
                  : t("printerProfilesCreateAction")}
            </Button>
            <Button type="button" variant="outline" onClick={closeFormModal} disabled={isSubmitting}>
              {t("cancelEdit")}
            </Button>
          </div>
        </form>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteOpen}
        title={common("deleteTitle", { item: t("printerProfileLabel") })}
        description={common("deleteDescriptionWithName", { name: profileToDelete?.name ?? "" })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDelete}
        onCancel={closeDeleteModal}
      />
    </ClubAdminLayout>
  );
}
