"use client";

import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { DragEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { ActionNotices } from "@/components/ui/list-page-chrome";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const LOGO_USAGE_TYPES = ["general", "invoice", "print", "digital"] as const;

export type LogoUsageType = (typeof LOGO_USAGE_TYPES)[number];

export type BrandingLogoItem = {
  id: number;
  usage_type: LogoUsageType;
  label: string;
  is_selected: boolean;
  file_name: string;
  file_size: number;
  content_url: string | null;
};

export type BrandingLogoUploadPayload = {
  file: File;
  usage_type: LogoUsageType;
  label: string;
  is_selected: boolean;
};

type BrandingLogosManagerProps = {
  logos: BrandingLogoItem[];
  isLoading?: boolean;
  loadError?: string | null;
  onUpload: (payload: BrandingLogoUploadPayload) => Promise<void>;
  onSelect: (logoId: number) => Promise<void>;
  onDelete: (logoId: number) => Promise<void>;
};

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return "-";
  }
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(2)} MB`;
  }
  return `${(bytes / kb).toFixed(1)} KB`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg|gif)$/i.test(file.name);
}

function isGeneratedFileName(fileName: string): boolean {
  return /^[a-f0-9]{16,}\.[a-z0-9]+$/i.test(fileName);
}

function logoDisplayName(logo: BrandingLogoItem, untitled: string): string {
  const label = logo.label?.trim() ?? "";
  if (label) {
    return label;
  }
  if (!isGeneratedFileName(logo.file_name)) {
    return logo.file_name;
  }
  return untitled;
}

function resolveImageRequestUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl, API_URL).toString();
  } catch {
    return rawUrl;
  }
}

function AuthenticatedLogoPreview({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const t = useTranslations("Common");
  const [blobUrl, setBlobUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    const controller = new AbortController();
    setBlobUrl("");
    setFailed(false);

    const load = async () => {
      const token = getToken();
      const response = await fetch(resolveImageRequestUrl(src), {
        method: "GET",
        signal: controller.signal,
        headers: token ? { Authorization: `Token ${token}` } : undefined,
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      setBlobUrl(objectUrl);
    };

    void load().catch(() => {
      if (!controller.signal.aborted) {
        setFailed(true);
      }
    });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted">
        {t("noPreviewAvailable")}
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    // Authenticated logo bytes are loaded as a blob URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={blobUrl} alt={alt} className="h-full w-full object-contain p-3" />
  );
}

export function BrandingLogosManager({
  logos,
  isLoading = false,
  loadError = null,
  onUpload,
  onSelect,
  onDelete,
}: BrandingLogosManagerProps) {
  const t = useTranslations("Common");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [logoUsage, setLogoUsage] = useState<LogoUsageType>("general");
  const [logoLabel, setLogoLabel] = useState("");
  const [markUploadedAsSelected, setMarkUploadedAsSelected] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [busyLogoId, setBusyLogoId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BrandingLogoItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const usageLabelMap = useMemo(
    () => ({
      general: t("logoUsageGeneral"),
      invoice: t("logoUsageInvoice"),
      print: t("logoUsagePrint"),
      digital: t("logoUsageDigital"),
    }),
    [t]
  );
  const usageHintMap = useMemo(
    () => ({
      general: t("logoUsageGeneralHint"),
      invoice: t("logoUsageInvoiceHint"),
      print: t("logoUsagePrintHint"),
      digital: t("logoUsageDigitalHint"),
    }),
    [t]
  );
  const selectedUsageLabel = usageLabelMap[logoUsage];

  const logosByUsage = useMemo(() => {
    return LOGO_USAGE_TYPES.map((usage) => {
      const items = logos
        .filter((logo) => logo.usage_type === usage)
        .slice()
        .sort((left, right) => Number(right.is_selected) - Number(left.is_selected));
      return { usage, items };
    });
  }, [logos]);

  useEffect(() => {
    if (!logoFile) {
      setPreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoFile]);

  const chooseFile = () => {
    fileInputRef.current?.click();
  };

  const assignFile = (file: File | null) => {
    if (file && !isImageFile(file)) {
      setErrorMessage(t("logoInvalidFileError"));
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    setLogoFile(file);
    if (fileInputRef.current && !file) {
      fileInputRef.current.value = "";
    }
  };

  const handleDropzoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseFile();
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    assignFile(file);
  };

  const handleUpload = async () => {
    if (!logoFile) {
      return;
    }
    setIsUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await onUpload({
        file: logoFile,
        usage_type: logoUsage,
        label: logoLabel.trim(),
        is_selected: markUploadedAsSelected,
      });
      assignFile(null);
      setLogoLabel("");
      setMarkUploadedAsSelected(true);
      setSuccessMessage(t("logoUploadSuccess"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("logoUploadError"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelect = async (logo: BrandingLogoItem) => {
    setBusyLogoId(logo.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await onSelect(logo.id);
      setSuccessMessage(t("logoSelectSuccess", { usage: usageLabelMap[logo.usage_type] }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("logoSelectError"));
    } finally {
      setBusyLogoId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    const logo = pendingDelete;
    setPendingDelete(null);
    setBusyLogoId(logo.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await onDelete(logo.id);
      setSuccessMessage(t("logoDeleteSuccess"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("logoDeleteError"));
    } finally {
      setBusyLogoId(null);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-sm">
      <ActionNotices
        error={errorMessage}
        success={successMessage}
        onDismiss={() => {
          setErrorMessage(null);
          setSuccessMessage(null);
        }}
      />
      <h2 className="text-lg font-semibold text-foreground">{t("logoSectionTitle")}</h2>
      <p className="mt-1 text-sm text-muted">{t("logoSectionSubtitle")}</p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        className="sr-only"
        onChange={(event) => assignFile(event.target.files?.[0] ?? null)}
      />

      <div
        className={cn(
          "mt-5 rounded-[var(--radius-card)] border border-dashed border-border bg-secondary/40 p-4 transition-colors",
          isDragging ? "border-primary bg-[var(--accent-soft)]" : null
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {logoFile ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-[var(--radius-form)] bg-card sm:w-40">
              {previewUrl ? (
                // Local object URLs are not valid next/image sources.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={logoFile.name} className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-muted">{t("noPreviewAvailable")}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{logoFile.name}</p>
              <p className="mt-1 text-xs text-muted">{formatFileSize(logoFile.size)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={chooseFile}>
                  {t("logoChangeFileAction")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => assignFile(null)}>
                  {t("logoClearFileAction")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 px-3 py-8 text-center"
            onClick={chooseFile}
            onKeyDown={handleDropzoneKeyDown}
          >
            <span className="inline-flex size-11 items-center justify-center rounded-[var(--radius-control)] bg-card text-muted">
              <ImagePlus className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-medium text-foreground">{t("logoDropTitle")}</p>
            <p className="text-xs text-muted">{t("logoDropHint")}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={(event) => {
                event.stopPropagation();
                chooseFile();
              }}
            >
              {t("chooseLogoFileAction")}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="branding-logo-label">{t("logoLabelInputLabel")}</Label>
          <Input
            id="branding-logo-label"
            value={logoLabel}
            onChange={(event) => setLogoLabel(event.target.value)}
            placeholder={t("logoLabelPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="branding-logo-usage">{t("logoUsageLabel")}</Label>
          <Select value={logoUsage} onValueChange={(value) => setLogoUsage(value as LogoUsageType)}>
            <SelectTrigger id="branding-logo-usage" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOGO_USAGE_TYPES.map((usage) => (
                <SelectItem key={usage} value={usage}>
                  {usageLabelMap[usage]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted">{usageHintMap[logoUsage]}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-start gap-2 text-sm text-foreground">
          <Checkbox
            checked={markUploadedAsSelected}
            onCheckedChange={(value) => setMarkUploadedAsSelected(value === true)}
            className="mt-0.5"
            aria-label={t("markLogoSelectedLabel", { usage: selectedUsageLabel })}
          />
          <span>{t("markLogoSelectedLabel", { usage: selectedUsageLabel })}</span>
        </label>
        <Button type="button" onClick={handleUpload} disabled={!logoFile || isUploading}>
          {isUploading ? t("savingAction") : t("uploadLogoAction")}
        </Button>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-foreground">{t("logoLibraryTitle")}</h3>
        {isLoading ? (
          <div className="mt-4 flex items-center gap-3 text-sm text-muted" role="status" aria-live="polite">
            <Spinner />
            <span>{t("loadingLabel")}</span>
          </div>
        ) : loadError ? (
          <div className="mt-4">
            <EmptyState title={t("logoEmptyTitle")} description={loadError} />
          </div>
        ) : logos.length === 0 ? (
          <div className="mt-4">
            <EmptyState title={t("logoEmptyTitle")} description={t("logoEmptyState")} />
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {logosByUsage.map(({ usage, items }) => (
              <div key={usage}>
                <div className="mb-3 flex flex-wrap items-baseline gap-2">
                  <h4 className="text-sm font-medium text-foreground">{usageLabelMap[usage]}</h4>
                  <p className="text-xs text-muted">{usageHintMap[usage]}</p>
                </div>
                {items.length === 0 ? (
                  <p className="rounded-[var(--radius-form)] border border-dashed border-border px-3 py-4 text-sm text-muted">
                    {t("logoUsageEmptyState", { usage: usageLabelMap[usage] })}
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((logo) => (
                      <article
                        key={logo.id}
                        className={cn(
                          "rounded-[var(--radius-card)] border border-border p-3",
                          logo.is_selected ? "border-primary" : null
                        )}
                      >
                        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[var(--radius-form)] bg-secondary">
                          {logo.content_url ? (
                            <AuthenticatedLogoPreview
                              src={logo.content_url}
                              alt={logo.label || logo.file_name}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-muted">
                              {t("noPreviewAvailable")}
                            </div>
                          )}
                          {logo.is_selected ? (
                            <span className="absolute right-2 top-2">
                              <StatusBadge label={t("logoSelectedBadge")} tone="success" />
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 min-w-0 space-y-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {logoDisplayName(
                              logo,
                              t("logoUntitled", { usage: usageLabelMap[logo.usage_type] })
                            )}
                          </p>
                          <p className="text-xs text-muted">{formatFileSize(logo.file_size)}</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!logo.is_selected ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyLogoId === logo.id}
                              onClick={() => void handleSelect(logo)}
                            >
                              {t("selectLogoAction")}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busyLogoId === logo.id}
                            onClick={() => setPendingDelete(logo)}
                          >
                            {t("deleteConfirmButton")}
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={pendingDelete !== null}
        title={t("logoDeleteTitle")}
        description={t("logoDeleteDescription", {
          name: pendingDelete
            ? logoDisplayName(
                pendingDelete,
                t("logoUntitled", { usage: usageLabelMap[pendingDelete.usage_type] })
              )
            : t("itemLogo"),
        })}
        confirmLabel={t("deleteConfirmButton")}
        cancelLabel={t("deleteCancelButton")}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
