"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConfirmResponse,
  ImportRow,
  confirmImport,
  previewImport,
} from "@/lib/import-api";

type ImportType = "clubs" | "members";
type WizardStep = "source" | "mapping" | "preview" | "confirm" | "result";
type RowAction = "create" | "skip";
type PreviewFilter = "all" | "ready" | "duplicate" | "invalid" | "skipped";
type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY" | "DD.MM.YYYY";

type FieldOption = {
  key: string;
  label: string;
  required?: boolean;
};

type ClubOption = {
  id: number;
  name: string;
};

type ImportWizardPageProps = {
  allowedTypes: ImportType[];
  defaultType: ImportType;
  fixedClubId?: number | null;
  allowClubSelection?: boolean;
  clubOptions?: ClubOption[];
  fieldsByType: Record<ImportType, FieldOption[]>;
  backHrefByType: Record<ImportType, string>;
  successHrefByType: Record<ImportType, string>;
};

type SummaryCounts = {
  total: number;
  ready: number;
  duplicate: number;
  invalid: number;
  skipped: number;
};

const DATE_FORMAT_OPTIONS: DateFormat[] = [
  "YYYY-MM-DD",
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
];

function buildAutoMapping(fields: FieldOption[], headers: string[]) {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  return fields.reduce<Record<string, string>>((accumulator, field) => {
    const index = normalizedHeaders.indexOf(field.key.toLowerCase());
    if (index >= 0) {
      accumulator[field.key] = headers[index];
    }
    return accumulator;
  }, {});
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getRowStatus(row: ImportRow, action: RowAction): PreviewFilter {
  if (action === "skip") {
    return "skipped";
  }
  if (row.errors.length > 0) {
    return "invalid";
  }
  if (row.duplicate) {
    return "duplicate";
  }
  return "ready";
}

function buildSummary(rows: ImportRow[], actions: Record<number, RowAction>): SummaryCounts {
  const summary: SummaryCounts = {
    total: rows.length,
    ready: 0,
    duplicate: 0,
    invalid: 0,
    skipped: 0,
  };
  for (const row of rows) {
    const action = actions[row.row_index] ?? "create";
    const status = getRowStatus(row, action);
    summary[status] += 1;
  }
  return summary;
}

export function ImportWizardPage({
  allowedTypes,
  defaultType,
  fixedClubId = null,
  allowClubSelection = false,
  clubOptions = [],
  fieldsByType,
  backHrefByType,
  successHrefByType,
}: ImportWizardPageProps) {
  const t = useTranslations("Import");
  const common = useTranslations("Common");

  const [step, setStep] = useState<WizardStep>("source");
  const [importType, setImportType] = useState<ImportType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [actions, setActions] = useState<Record<number, RowAction>>({});
  const [selectedClubId, setSelectedClubId] = useState<number | null>(
    fixedClubId ?? (clubOptions[0]?.id ?? null)
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [isPreviewDirty, setIsPreviewDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [hasPreviewRun, setHasPreviewRun] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canSwitchType = allowedTypes.length > 1;
  const isMembersImport = importType === "members";
  const currentFields = fieldsByType[importType];
  const requiredFields = useMemo(
    () => currentFields.filter((field) => field.required),
    [currentFields]
  );
  const mappingComplete = useMemo(
    () => requiredFields.every((field) => Boolean(mapping[field.key])),
    [mapping, requiredFields]
  );

  const selectedClubName = useMemo(() => {
    if (!selectedClubId) {
      return null;
    }
    return clubOptions.find((club) => club.id === selectedClubId)?.name ?? null;
  }, [clubOptions, selectedClubId]);

  const summary = useMemo(
    () => buildSummary(previewRows, actions),
    [actions, previewRows]
  );

  const filteredPreviewRows = useMemo(() => {
    if (previewFilter === "all") {
      return previewRows;
    }
    return previewRows.filter((row) => {
      const action = actions[row.row_index] ?? "create";
      return getRowStatus(row, action) === previewFilter;
    });
  }, [actions, previewFilter, previewRows]);

  useEffect(() => {
    if (fixedClubId && fixedClubId !== selectedClubId) {
      setSelectedClubId(fixedClubId);
    }
  }, [fixedClubId, selectedClubId]);

  useEffect(() => {
    if (!fixedClubId && clubOptions.length > 0 && !selectedClubId) {
      setSelectedClubId(clubOptions[0].id);
    }
  }, [clubOptions, fixedClubId, selectedClubId]);

  useEffect(() => {
    if (typeof window === "undefined" || !isMembersImport) {
      return;
    }
    const savedDateFormat = window.sessionStorage.getItem("import_members_date_format");
    if (
      savedDateFormat === "YYYY-MM-DD" ||
      savedDateFormat === "DD/MM/YYYY" ||
      savedDateFormat === "DD-MM-YYYY" ||
      savedDateFormat === "DD.MM.YYYY"
    ) {
      setDateFormat(savedDateFormat);
    }
  }, [isMembersImport]);

  useEffect(() => {
    if (typeof window === "undefined" || !isMembersImport) {
      return;
    }
    window.sessionStorage.setItem("import_members_date_format", dateFormat);
  }, [dateFormat, isMembersImport]);

  const resetFlow = () => {
    setStep("source");
    setFile(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping({});
    setPreviewRows([]);
    setActions({});
    setPreviewFilter("all");
    setIsPreviewDirty(false);
    setHasPreviewRun(false);
    setErrorMessage(null);
    setResult(null);
    setIsLoading(false);
  };

  const resetFromCurrentConfig = (nextType: ImportType) => {
    setImportType(nextType);
    setStep("source");
    setFile(null);
    setHeaders([]);
    setSampleRows([]);
    setMapping({});
    setPreviewRows([]);
    setActions({});
    setPreviewFilter("all");
    setIsPreviewDirty(false);
    setHasPreviewRun(false);
    setErrorMessage(null);
    setResult(null);
    if (fixedClubId) {
      setSelectedClubId(fixedClubId);
    } else if (clubOptions.length > 0) {
      setSelectedClubId(clubOptions[0].id);
    } else {
      setSelectedClubId(null);
    }
  };

  const invalidatePreview = () => {
    setIsPreviewDirty(hasPreviewRun || previewRows.length > 0 || Boolean(result));
    setPreviewRows([]);
    setActions({});
    setResult(null);
  };

  const handleTypeChange = (value: string) => {
    if (value !== "clubs" && value !== "members") {
      return;
    }
    resetFromCurrentConfig(value);
  };

  const handleClubChange = (value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    setSelectedClubId(parsed);
    invalidatePreview();
    if (step !== "source") {
      setStep("source");
    }
  };

  const handleDateFormatChange = (value: string) => {
    if (
      value !== "YYYY-MM-DD" &&
      value !== "DD/MM/YYYY" &&
      value !== "DD-MM-YYYY" &&
      value !== "DD.MM.YYYY"
    ) {
      return;
    }
    setDateFormat(value);
    invalidatePreview();
    if (step !== "source") {
      setStep("source");
    }
  };

  const handleFileChange = async (nextFile: File | null) => {
    if (!nextFile) {
      setFile(null);
      setHeaders([]);
      setSampleRows([]);
      setMapping({});
      setPreviewRows([]);
      setActions({});
      setResult(null);
      setHasPreviewRun(false);
      setIsPreviewDirty(false);
      return;
    }
    if (isMembersImport && !selectedClubId) {
      setErrorMessage(t("selectClubRequired"));
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);
    setFile(nextFile);
    setResult(null);
    setStep("source");
    try {
      const preview = await previewImport(
        importType,
        nextFile,
        undefined,
        selectedClubId ?? undefined,
        isMembersImport ? dateFormat : undefined
      );
      setHeaders(preview.headers ?? []);
      setSampleRows(preview.sample_rows ?? []);
      setMapping(buildAutoMapping(currentFields, preview.headers ?? []));
      setPreviewRows([]);
      setActions({});
      setPreviewFilter("all");
      setHasPreviewRun(false);
      setIsPreviewDirty(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("previewFailed"));
      setHeaders([]);
      setSampleRows([]);
      setMapping({});
      setPreviewRows([]);
      setActions({});
      setPreviewFilter("all");
      setHasPreviewRun(false);
      setIsPreviewDirty(false);
    } finally {
      setIsLoading(false);
    }
  };

  const setFieldMapping = (fieldKey: string, selectedHeader: string) => {
    setMapping((previous) => {
      const next = { ...previous };
      if (selectedHeader === "__none__") {
        delete next[fieldKey];
      } else {
        next[fieldKey] = selectedHeader;
      }
      return next;
    });
    invalidatePreview();
    if (step !== "mapping") {
      setStep("mapping");
    }
  };

  const handleAutoMap = () => {
    setMapping(buildAutoMapping(currentFields, headers));
    invalidatePreview();
    if (step !== "mapping") {
      setStep("mapping");
    }
  };

  const runPreview = async () => {
    if (!file || !mappingComplete) {
      return;
    }
    if (isMembersImport && !selectedClubId) {
      setErrorMessage(t("selectClubRequired"));
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const preview = await previewImport(
        importType,
        file,
        mapping,
        selectedClubId ?? undefined,
        isMembersImport ? dateFormat : undefined
      );
      const rows = preview.rows ?? [];
      const defaultActions = rows.reduce<Record<number, RowAction>>((accumulator, row) => {
        accumulator[row.row_index] = "create";
        return accumulator;
      }, {});
      setPreviewRows(rows);
      setActions(defaultActions);
      setPreviewFilter("all");
      setHasPreviewRun(true);
      setIsPreviewDirty(false);
      setStep("preview");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("previewFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const runImport = async () => {
    if (!file || !mappingComplete || previewRows.length === 0) {
      return;
    }
    if (isMembersImport && !selectedClubId) {
      setErrorMessage(t("selectClubRequired"));
      return;
    }
    if (isPreviewDirty) {
      setErrorMessage(t("previewOutdated"));
      return;
    }
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const actionList = previewRows.map((row) => ({
        row_index: row.row_index,
        action: actions[row.row_index] ?? "create",
      }));
      const importResult = await confirmImport(
        importType,
        file,
        mapping,
        actionList,
        selectedClubId ?? undefined,
        isMembersImport ? dateFormat : undefined
      );
      setResult(importResult);
      setStep("result");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("importFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const setRowAction = (rowIndex: number, value: string) => {
    if (value !== "create" && value !== "skip") {
      return;
    }
    setActions((previous) => ({ ...previous, [rowIndex]: value }));
  };

  const runBulkSkipInvalid = () => {
    setActions((previous) => {
      const next = { ...previous };
      for (const row of previewRows) {
        if (row.errors.length > 0) {
          next[row.row_index] = "skip";
        }
      }
      return next;
    });
  };

  const runBulkCreateReady = () => {
    setActions((previous) => {
      const next = { ...previous };
      for (const row of previewRows) {
        const currentAction = next[row.row_index] ?? "create";
        const status = getRowStatus(row, currentAction);
        if (status === "ready") {
          next[row.row_index] = "create";
        }
      }
      return next;
    });
  };

  const goBackStep = () => {
    if (step === "result") {
      setStep("confirm");
      return;
    }
    if (step === "confirm") {
      setStep("preview");
      return;
    }
    if (step === "preview") {
      setStep("mapping");
      return;
    }
    if (step === "mapping") {
      setStep("source");
      return;
    }
  };

  const stepOrder: WizardStep[] = ["source", "mapping", "preview", "confirm", "result"];
  const stepTitles: Record<WizardStep, string> = {
    source: t("sourceStepTitle"),
    mapping: t("mappingStepTitle"),
    preview: t("previewStepTitle"),
    confirm: t("confirmStepTitle"),
    result: t("resultStepTitle"),
  };
  const currentStepIndex = stepOrder.indexOf(step);

  const canContinueFromSource =
    Boolean(file) &&
    headers.length > 0 &&
    !isLoading &&
    (!isMembersImport || Boolean(selectedClubId));
  const canRunPreview =
    Boolean(file) &&
    mappingComplete &&
    !isLoading &&
    (!isMembersImport || Boolean(selectedClubId));
  const canContinueToConfirm = previewRows.length > 0 && !isPreviewDirty && !isLoading;
  const canRunImport = previewRows.length > 0 && !isPreviewDirty && !isLoading;

  const primaryLabel =
    step === "source"
      ? t("continueToMapping")
      : step === "mapping"
      ? t("previewButton")
      : step === "preview"
      ? t("continueToConfirm")
      : step === "confirm"
      ? t("startImport")
      : t("importAnother");

  const primaryDisabled =
    step === "source"
      ? !canContinueFromSource
      : step === "mapping"
      ? !canRunPreview
      : step === "preview"
      ? !canContinueToConfirm
      : step === "confirm"
      ? !canRunImport
      : false;

  const handlePrimaryAction = async () => {
    if (step === "source") {
      if (canContinueFromSource) {
        setStep("mapping");
      }
      return;
    }
    if (step === "mapping") {
      await runPreview();
      return;
    }
    if (step === "preview") {
      if (canContinueToConfirm) {
        setStep("confirm");
      }
      return;
    }
    if (step === "confirm") {
      await runImport();
      return;
    }
    resetFlow();
  };

  const showBackButton = step !== "source";
  const showListButton = step === "source" || step === "result";
  const summaryPreviewState: "idle" | "ready" | "stale" | "current" = !file
    ? "idle"
    : !hasPreviewRun
    ? "ready"
    : isPreviewDirty
    ? "stale"
    : "current";

  return (
    <div className="space-y-4">
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {stepOrder.map((stepItem, index) => {
            const isCurrent = stepItem === step;
            const isDone = index < currentStepIndex;
            return (
              <span
                key={stepItem}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                  isCurrent
                    ? "border-zinc-800 bg-zinc-900 text-white"
                    : isDone
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-zinc-300 bg-zinc-100 text-zinc-600"
                }`}
              >
                <span>{index + 1}</span>
                <span>{stepTitles[stepItem]}</span>
              </span>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          {step === "source" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-900">{t("sourceStepTitle")}</h2>
                <p className="text-sm text-zinc-500">{t("sourceStepSubtitle")}</p>
              </div>

              {canSwitchType ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-zinc-700">{t("importTypeLabel")}</label>
                  <Select value={importType} onValueChange={handleTypeChange}>
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedTypes.includes("clubs") ? (
                        <SelectItem value="clubs">{t("importClubs")}</SelectItem>
                      ) : null}
                      {allowedTypes.includes("members") ? (
                        <SelectItem value="members">{t("importMembers")}</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {isMembersImport ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("clubLabel")}</label>
                    {allowClubSelection && !fixedClubId ? (
                      <Select
                        value={selectedClubId ? String(selectedClubId) : ""}
                        onValueChange={handleClubChange}
                      >
                        <SelectTrigger className="w-80">
                          <SelectValue placeholder={t("selectClubPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {clubOptions.map((club) => (
                            <SelectItem key={club.id} value={String(club.id)}>
                              {club.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                        {selectedClubName ?? "-"}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">{t("dateFormatLabel")}</label>
                    <Select value={dateFormat} onValueChange={handleDateFormatChange}>
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATE_FORMAT_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("fileLabel")}</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLoading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {file ? t("changeFileButton") : t("chooseFileButton")}
                  </Button>
                  <span className="text-sm text-zinc-600">
                    {file ? file.name : t("noFileSelected")}
                  </span>
                </div>
              </div>

              {file ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  <p>
                    <span className="font-medium">{t("fileNameLabel")}:</span> {file.name}
                  </p>
                  <p>
                    <span className="font-medium">{t("fileSizeLabel")}:</span> {formatFileSize(file.size)}
                  </p>
                  <p>
                    <span className="font-medium">{t("totalColumnsLabel")}:</span> {headers.length}
                  </p>
                  <p>
                    <span className="font-medium">{t("totalRowsLabel")}:</span>{" "}
                    {sampleRows.length > 0 ? `${sampleRows.length}+` : "-"}
                  </p>
                </div>
              ) : null}

              {headers.length > 0 && sampleRows.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-zinc-700">{t("sampleRowsTitle")}</p>
                  <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                        <tr>
                          {headers.map((header) => (
                            <th key={header} className="px-2 py-2 font-medium">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sampleRows.map((row, index) => (
                          <tr key={`${index}-${row.join("|")}`} className="border-t border-zinc-100 text-zinc-700">
                            {headers.map((_, headerIndex) => (
                              <td key={`${index}-${headerIndex}`} className="px-2 py-2">
                                {row[headerIndex] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "mapping" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-900">{t("mappingStepTitle")}</h2>
                <p className="text-sm text-zinc-500">{t("mappingStepSubtitle")}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleAutoMap} disabled={headers.length === 0}>
                  {t("autoMapButton")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMapping({});
                    invalidatePreview();
                  }}
                  disabled={Object.keys(mapping).length === 0}
                >
                  {t("clearMappingButton")}
                </Button>
              </div>

              <div className="max-h-[520px] overflow-auto rounded-lg border border-zinc-200">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("targetFieldLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("requiredFieldLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("sourceColumnLabel")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentFields.map((field) => (
                      <tr key={field.key} className="border-t border-zinc-100 text-zinc-700">
                        <td className="px-3 py-2">{field.label}</td>
                        <td className="px-3 py-2">{field.required ? t("requiredBadge") : "-"}</td>
                        <td className="px-3 py-2">
                          <Select
                            value={mapping[field.key] ?? "__none__"}
                            onValueChange={(value) => setFieldMapping(field.key, value)}
                          >
                            <SelectTrigger className="w-72">
                              <SelectValue placeholder={t("selectColumnPlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{t("notMappedOption")}</SelectItem>
                              {headers.map((header) => (
                                <SelectItem key={header} value={header}>
                                  {header}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-sm text-zinc-500">
                {t("mappingProgressLabel", {
                  mapped: requiredFields.filter((field) => mapping[field.key]).length,
                  total: requiredFields.length,
                })}
              </p>
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-900">{t("previewStepTitle")}</h2>
                <p className="text-sm text-zinc-500">{t("previewStepSubtitle")}</p>
              </div>

              {isPreviewDirty ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t("previewOutdated")}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "all", label: t("filterAll"), count: summary.total },
                    { id: "ready", label: t("statusReady"), count: summary.ready },
                    { id: "duplicate", label: t("statusDuplicate"), count: summary.duplicate },
                    { id: "invalid", label: t("statusInvalid"), count: summary.invalid },
                    { id: "skipped", label: t("statusSkipped"), count: summary.skipped },
                  ] as const
                ).map((filterItem) => {
                  const active = previewFilter === filterItem.id;
                  return (
                    <button
                      key={filterItem.id}
                      type="button"
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                        active
                          ? "border-zinc-700 bg-zinc-800 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
                      }`}
                      onClick={() => setPreviewFilter(filterItem.id)}
                    >
                      {filterItem.label} ({filterItem.count})
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={runBulkSkipInvalid}>
                  {t("skipInvalidRowsButton")}
                </Button>
                <Button variant="outline" size="sm" onClick={runBulkCreateReady}>
                  {t("createReadyRowsButton")}
                </Button>
              </div>

              <div className="max-h-[520px] overflow-auto rounded-lg border border-zinc-200">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">{t("rowLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("statusLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("dataLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("errorsLabel")}</th>
                      <th className="px-2 py-2 font-medium">{t("actionLabel")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.map((row) => {
                      const action = actions[row.row_index] ?? "create";
                      const status = getRowStatus(row, action);
                      return (
                        <tr key={row.row_index} className="border-t border-zinc-100 text-zinc-700">
                          <td className="px-2 py-2">{row.row_index}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                                status === "ready"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : status === "duplicate"
                                  ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : status === "invalid"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-zinc-300 bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {status === "ready"
                                ? t("statusReady")
                                : status === "duplicate"
                                ? t("statusDuplicate")
                                : status === "invalid"
                                ? t("statusInvalid")
                                : t("statusSkipped")}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {Object.entries(row.data)
                              .filter(([, value]) => value !== null && value !== "")
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(", ")}
                          </td>
                          <td className="px-2 py-2 text-xs text-rose-700">
                            {row.errors.join(", ")}
                            {row.duplicate ? ` ${t("duplicateHint")}` : ""}
                          </td>
                          <td className="px-2 py-2">
                            <Select
                              value={action}
                              onValueChange={(value) => setRowAction(row.row_index, value)}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create">{t("createAction")}</SelectItem>
                                <SelectItem value="skip">{t("skipAction")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {step === "confirm" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-900">{t("confirmStepTitle")}</h2>
                <p className="text-sm text-zinc-500">{t("confirmStepSubtitle")}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  <p>
                    <span className="font-medium">{t("statusReady")}:</span> {summary.ready}
                  </p>
                  <p>
                    <span className="font-medium">{t("statusDuplicate")}:</span> {summary.duplicate}
                  </p>
                  <p>
                    <span className="font-medium">{t("statusInvalid")}:</span> {summary.invalid}
                  </p>
                  <p>
                    <span className="font-medium">{t("statusSkipped")}:</span> {summary.skipped}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  <p>
                    <span className="font-medium">{t("importTypeLabel")}:</span>{" "}
                    {importType === "members" ? t("importMembers") : t("importClubs")}
                  </p>
                  {isMembersImport ? (
                    <>
                      <p>
                        <span className="font-medium">{t("clubLabel")}:</span>{" "}
                        {selectedClubName ?? "-"}
                      </p>
                      <p>
                        <span className="font-medium">{t("dateFormatLabel")}:</span> {dateFormat}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("confirmWarning")}
              </p>
            </div>
          ) : null}

          {step === "result" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-900">{t("resultStepTitle")}</h2>
                <p className="text-sm text-zinc-500">{t("resultStepSubtitle")}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <span className="font-medium">{t("resultCreated")}:</span> {result?.created ?? 0}
                </div>
                <div className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
                  <span className="font-medium">{t("resultSkipped")}:</span> {result?.skipped ?? 0}
                </div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  <span className="font-medium">{t("resultErrors")}:</span> {result?.errors.length ?? 0}
                </div>
              </div>

              {result && result.errors.length > 0 ? (
                <div className="max-h-[340px] overflow-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="px-2 py-2 font-medium">{t("rowLabel")}</th>
                        <th className="px-2 py-2 font-medium">{t("errorsLabel")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((item) => (
                        <tr key={`err-${item.row_index}`} className="border-t border-zinc-100 text-zinc-700">
                          <td className="px-2 py-2">{item.row_index}</td>
                          <td className="px-2 py-2 text-rose-700">{item.errors.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-zinc-900">{t("summaryTitle")}</h3>
          <div className="mt-3 space-y-2 text-sm text-zinc-700">
            <p>
              <span className="font-medium">{t("importTypeLabel")}:</span>{" "}
              {importType === "members" ? t("importMembers") : t("importClubs")}
            </p>
            {isMembersImport ? (
              <>
                <p>
                  <span className="font-medium">{t("clubLabel")}:</span> {selectedClubName ?? "-"}
                </p>
                <p>
                  <span className="font-medium">{t("dateFormatLabel")}:</span> {dateFormat}
                </p>
              </>
            ) : null}
            <p>
              <span className="font-medium">{t("totalRowsLabel")}:</span> {summary.total}
            </p>
            <p>
              <span className="font-medium">{t("statusReady")}:</span> {summary.ready}
            </p>
            <p>
              <span className="font-medium">{t("statusDuplicate")}:</span> {summary.duplicate}
            </p>
            <p>
              <span className="font-medium">{t("statusInvalid")}:</span> {summary.invalid}
            </p>
            <p>
              <span className="font-medium">{t("statusSkipped")}:</span> {summary.skipped}
            </p>
          </div>
          <p
            className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
              summaryPreviewState === "stale"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : summaryPreviewState === "current"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : summaryPreviewState === "ready"
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-zinc-300 bg-zinc-100 text-zinc-700"
            }`}
          >
            {summaryPreviewState === "stale"
              ? t("summaryPreviewOutdated")
              : summaryPreviewState === "current"
              ? t("summaryPreviewCurrent")
              : summaryPreviewState === "ready"
              ? t("summaryPreviewReady")
              : t("summaryPreviewNotStarted")}
          </p>
        </aside>
      </div>

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {showListButton ? (
              <Button variant="outline" asChild>
                <Link href={step === "result" ? successHrefByType[importType] : backHrefByType[importType]}>
                  {step === "result" ? t("backToList") : t("cancelAndBack")}
                </Link>
              </Button>
            ) : null}
            {showBackButton ? (
              <Button variant="outline" onClick={goBackStep} disabled={isLoading}>
                {common("previousPage")}
              </Button>
            ) : null}
          </div>
          <Button onClick={handlePrimaryAction} disabled={primaryDisabled}>
            {isLoading ? t("loadingAction") : primaryLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
