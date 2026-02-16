"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Trash2 } from "lucide-react";

import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { EntityTable } from "@/components/club-admin/entity-table";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";
import {
  LicenseType,
  createLicenseType,
  deleteLicenseType,
  getLicenseTypes,
  updateLicenseType,
} from "@/lib/ltf-admin-api";

const licenseTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type LicenseTypeFormValues = z.infer<typeof licenseTypeSchema>;
type AuthMeResponse = { role: string };

export default function LtfAdminLicenseTypesPage() {
  const t = useTranslations("LtfAdmin");
  const common = useTranslations("Common");
  const [licenseTypes, setLicenseTypes] = useState<LicenseType[]>([]);
  const [editingType, setEditingType] = useState<LicenseType | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [licenseTypeToDelete, setLicenseTypeToDelete] = useState<LicenseType | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LicenseTypeFormValues>({
    resolver: zodResolver(licenseTypeSchema),
    defaultValues: {
      name: "",
    },
  });

  const loadLicenseTypes = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await getLicenseTypes();
      setLicenseTypes(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load license types.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLicenseTypes();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadCurrentUserRole = async () => {
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        if (isMounted) {
          setCurrentRole(me.role);
        }
      } catch {
        if (isMounted) {
          setCurrentRole(null);
        }
      }
    };
    loadCurrentUserRole();
    return () => {
      isMounted = false;
    };
  }, []);

  const canManageLicenseTypes = currentRole === "ltf_finance";

  const filteredTypes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return licenseTypes;
    }
    return licenseTypes.filter((licenseType) => {
      return (
        licenseType.name.toLowerCase().includes(normalizedQuery) ||
        licenseType.code.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [licenseTypes, searchQuery]);

  const onSubmit = async (values: LicenseTypeFormValues) => {
    setErrorMessage(null);
    try {
      if (editingType) {
        await updateLicenseType(editingType.id, { name: values.name });
      } else {
        await createLicenseType({ name: values.name });
      }
      setEditingType(null);
      setIsFormOpen(false);
      reset({ name: "" });
      await loadLicenseTypes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save license type.");
    }
  };

  const startCreate = () => {
    setEditingType(null);
    setIsFormOpen(true);
    reset({ name: "" });
  };

  const startEdit = (licenseType: LicenseType) => {
    setEditingType(licenseType);
    setIsFormOpen(true);
    reset({ name: licenseType.name });
  };

  const handleDelete = (licenseType: LicenseType) => {
    setLicenseTypeToDelete(licenseType);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!licenseTypeToDelete) {
      return;
    }
    try {
      await deleteLicenseType(licenseTypeToDelete.id);
      setIsDeleteOpen(false);
      setLicenseTypeToDelete(null);
      await loadLicenseTypes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete license type.");
    }
  };

  return (
    <LtfAdminLayout title={t("licenseTypesTitle")} subtitle={t("licenseTypesSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            className="w-full max-w-xs"
            placeholder={t("searchLicenseTypesPlaceholder")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {canManageLicenseTypes ? <Button onClick={startCreate}>{t("createLicenseType")}</Button> : null}
        </div>
        {!canManageLicenseTypes ? (
          <p className="text-sm text-zinc-500">{t("licenseTypesReadOnlyHint")}</p>
        ) : null}

        {isLoading ? (
          <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
        ) : filteredTypes.length === 0 ? (
          <EmptyState title={t("noResultsTitle")} description={t("noLicenseTypesResultsSubtitle")} />
        ) : (
          <EntityTable
            columns={[
              { key: "name", header: t("licenseTypeNameLabel") },
              { key: "code", header: t("licenseTypeCodeLabel") },
              ...(canManageLicenseTypes
                ? [
                    {
                      key: "actions",
                      header: t("actionsLabel"),
                      render: (licenseType: LicenseType) => (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label={t("editAction")}
                            onClick={() => startEdit(licenseType)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="icon-sm"
                            aria-label={t("deleteAction")}
                            onClick={() => handleDelete(licenseType)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={filteredTypes}
          />
        )}
      </div>

      <Modal
        title={editingType ? t("updateLicenseType") : t("createLicenseType")}
        description={t("licenseTypeFormSubtitle")}
        isOpen={isFormOpen && canManageLicenseTypes}
        onClose={() => setIsFormOpen(false)}
      >
        <form className="grid gap-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">{t("licenseTypeNameLabel")}</label>
            <Input placeholder={t("licenseTypeNamePlaceholder")} {...register("name")} />
            {errors.name ? <p className="text-sm text-red-600">{errors.name.message}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSubmitting}>
              {editingType ? t("updateLicenseType") : t("createLicenseType")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingType(null);
                setIsFormOpen(false);
                reset({ name: "" });
              }}
            >
              {t("cancelEdit")}
            </Button>
          </div>
        </form>
      </Modal>

      <DeleteConfirmModal
        isOpen={isDeleteOpen && canManageLicenseTypes}
        title={common("deleteTitle", { item: t("licenseTypeLabel") })}
        description={common("deleteDescriptionWithName", {
          name: licenseTypeToDelete?.name ?? "",
        })}
        confirmLabel={common("deleteConfirmButton")}
        cancelLabel={common("deleteCancelButton")}
        onConfirm={confirmDelete}
        onCancel={() => {
          setIsDeleteOpen(false);
          setLicenseTypeToDelete(null);
        }}
      />
    </LtfAdminLayout>
  );
}
