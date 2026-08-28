"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/list-page-chrome";
import { Modal } from "@/components/ui/modal";
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
  LtfLicensePrefixRewritePolicy,
  confirmImport,
  previewImport,
} from "@/lib/import-api";
import {
  LICENSE_ROLE_VALUES,
  type LicenseRoleValue,
  canonicalizeLicenseRole,
  licenseRoleMessageKey,
} from "@/lib/license-roles";

type ImportType = "clubs" | "members";
type WizardStep = "source" | "mapping" | "preview" | "confirm" | "result";
type RowAction = "create" | "skip";
type PreviewFilter = "all" | "ready" | "duplicate" | "invalid" | "skipped";
type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY" | "DD.MM.YYYY";

// Role override for a single row
type RowRoleOverride = {
  primary_license_role?: string;
  secondary_license_role?: string;
};

type ConfirmRowOverridePayload = {
  row_index: number;
  primary_license_role: string;
  secondary_license_role: string;
};

// Build row_overrides payload for confirm import from effective preview rows
// and explicit Step 3 role corrections. Sends sanitized primary/secondary pairs
// for every create row so confirm never re-applies invalid raw CSV role strings.
function buildConfirmRowOverrides(
  rows: ImportRow[],
  overrides: Record<number, RowRoleOverride>,
  rowActions: Record<number, RowAction>
): ConfirmRowOverridePayload[] | undefined {
  const result: ConfirmRowOverridePayload[] = [];

  for (const row of rows) {
    const action = rowActions[row.row_index] ?? "create";
    if (action !== "create") {
      continue;
    }

    const explicit = overrides[row.row_index];
    const primaryRaw =
      explicit?.primary_license_role !== undefined
        ? explicit.primary_license_role
        : getTrimmedRoleValue(row, "primary_license_role");
    const secondaryRaw =
      explicit?.secondary_license_role !== undefined
        ? explicit.secondary_license_role
        : getTrimmedRoleValue(row, "secondary_license_role");

    result.push({
      row_index: row.row_index,
      primary_license_role: sanitizeRoleForOverride(primaryRaw),
      secondary_license_role: sanitizeRoleForOverride(secondaryRaw),
    });
  }

  return result.length > 0 ? result : undefined;
}

// Display status includes "review" for role-related issues
type RowDisplayStatus = "ready" | "duplicate" | "invalid" | "skipped" | "review";

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

// Normalize role input like backend: lowercase, trim, replace _ and - with spaces.
// Used only for equality checks so "athlete" and "Athlete" still compare equal.
function normalizeRoleInput(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/_/g, " ")
    .replace(/-/g, " ");
}

// Check if a role value is valid in any casing used by CSV, preview, or overrides.
function isValidLicenseRole(value: string): value is LicenseRoleValue {
  if (!value) return false;
  return canonicalizeLicenseRole(value) !== "";
}

// Check if an error message is role-related
function isRoleRelatedError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("primary_license_role") ||
    lower.includes("secondary_license_role") ||
    lower.includes("must be one of:")
  );
}

// Values treated as "no secondary role provided" — never trigger Review.
const SECONDARY_MISSING_VALUES = new Set([
  "",
  "-",
  "*",
  "/",
  "none",
  "null",
  "n/a",
]);

function isEmptyRoleValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  const trimmed = String(value).trim().toLowerCase();
  return SECONDARY_MISSING_VALUES.has(trimmed);
}

function getTrimmedRoleValue(
  row: ImportRow,
  field: "primary_license_role" | "secondary_license_role"
): string {
  const value = row.data[field];
  if (isEmptyRoleValue(value)) {
    return "";
  }
  return String(value).trim();
}

// Normalize a role for the confirm payload: capitalized canonical value or empty string.
function sanitizeRoleForOverride(value: string): string {
  if (!value || isEmptyRoleValue(value)) {
    return "";
  }
  return canonicalizeLicenseRole(String(value).trim());
}

// Check if a row has a license-role issue that should show as Review.
//
// Secondary: the backend normalizes invalid values to "" before storing in
// preview data. Both truly-empty and invalid-normalised secondaries arrive as
// "" in row.data. We treat all values in SECONDARY_MISSING_VALUES (plus the
// backend-normalised "") as "no secondary provided" and skip the secondary
// block entirely — they never trigger Review.
// Secondary constraint violations (requires primary / must differ) are caught
// by the error check inside the block, but only when secondary is a real
// non-missing value in row.data (e.g. a valid role like "athlete").
function hasRoleIssue(row: ImportRow): boolean {
  const primary = getTrimmedRoleValue(row, "primary_license_role");
  const secondary = getTrimmedRoleValue(row, "secondary_license_role");

  // Primary: invalid non-empty value OR any backend error mentioning primary role.
  if (primary && !isValidLicenseRole(primary)) {
    return true;
  }
  if (row.errors.some((e) => e.toLowerCase().includes("primary_license_role"))) {
    return true;
  }

  // Secondary: skipped entirely when value is empty / missing / placeholder.
  // Values like "-", "None", "n/a", " " all resolve to "" via getTrimmedRoleValue.
  if (secondary) {
    if (!isValidLicenseRole(secondary)) {
      return true;
    }
    // Valid secondary but constraint violation (e.g. "requires primary", "must differ").
    if (row.errors.some((e) => e.toLowerCase().includes("secondary_license_role"))) {
      return true;
    }
    // Both roles valid but identical — flag as a role issue regardless of backend errors.
    if (
      primary &&
      isValidLicenseRole(primary) &&
      normalizeRoleInput(primary) === normalizeRoleInput(secondary)
    ) {
      return true;
    }
  }

  return false;
}

// Apply role overrides to a row's errors, returning new errors array
function applyRoleOverrides(
  row: ImportRow,
  override: RowRoleOverride | undefined
): string[] {
  if (!override) return row.errors;

  const newErrors: string[] = [];
  const primary = override.primary_license_role;
  const secondary = override.secondary_license_role;

  for (const error of row.errors) {
    // If this is a role-related error, check if override resolves it
    if (isRoleRelatedError(error)) {
      // Skip role errors that are resolved by valid override values
      const isPrimaryError = error.toLowerCase().includes("primary_license_role");
      const isSecondaryError = error.toLowerCase().includes("secondary_license_role");

      if (isPrimaryError && primary && isValidLicenseRole(primary)) {
        continue; // Skip this error, primary role is now valid
      }
      if (isSecondaryError && secondary && isValidLicenseRole(secondary)) {
        // Also check secondary constraints
        if (primary && isValidLicenseRole(primary)) {
          if (normalizeRoleInput(secondary) !== normalizeRoleInput(primary)) {
            continue; // Skip this error, secondary role is valid and different from primary
          } else {
            newErrors.push("secondary_license_role must differ from primary_license_role");
            continue;
          }
        }
        continue;
      }
      // Keep unresolved role errors
      newErrors.push(error);
    } else {
      // Non-role errors always kept
      newErrors.push(error);
    }
  }

  // Effective role values for constraint checks below.
  // When the user only overrides one role field, fall back to the row's current
  // data value for the other — this ensures constraint violations are detected
  // immediately even when only one side of the pair has been changed.
  const effPrimary =
    primary !== undefined ? primary : getTrimmedRoleValue(row, "primary_license_role");
  const effSecondary =
    secondary !== undefined ? secondary : getTrimmedRoleValue(row, "secondary_license_role");

  // If the effective roles are now different, strip any stale "must differ" errors
  // that the loop may have carried over from before the override was applied.
  const effectivelyDiffer =
    !effPrimary ||
    !effSecondary ||
    !isValidLicenseRole(effPrimary) ||
    !isValidLicenseRole(effSecondary) ||
    normalizeRoleInput(effPrimary) !== normalizeRoleInput(effSecondary);

  if (effectivelyDiffer) {
    for (let i = newErrors.length - 1; i >= 0; i--) {
      if (newErrors[i].toLowerCase().includes("must differ from primary")) {
        newErrors.splice(i, 1);
      }
    }
  }

  // Secondary requires primary
  if (effSecondary && isValidLicenseRole(effSecondary)) {
    if (!effPrimary || !isValidLicenseRole(effPrimary)) {
      const hasSecondaryRequiresPrimary = newErrors.some(
        (e) => e.toLowerCase().includes("secondary_license_role requires primary_license_role")
      );
      if (!hasSecondaryRequiresPrimary) {
        newErrors.push("secondary_license_role requires primary_license_role");
      }
    }
  }

  // Primary must not equal secondary
  if (
    effPrimary &&
    isValidLicenseRole(effPrimary) &&
    effSecondary &&
    isValidLicenseRole(effSecondary) &&
    normalizeRoleInput(effPrimary) === normalizeRoleInput(effSecondary)
  ) {
    const hasSameError = newErrors.some(
      (e) => e.toLowerCase().includes("must differ from primary")
    );
    if (!hasSameError) {
      newErrors.push("secondary_license_role must differ from primary_license_role");
    }
  }

  return newErrors;
}

// Remove secondary_license_role errors from a row when the secondary value is
// a missing/placeholder value (empty, "-", "None", etc.). This prevents those
// rows from showing as Invalid solely because of a harmless placeholder in the
// secondary column — they should show as Ready if no other errors exist.
function suppressMissingSecondaryErrors(row: ImportRow): ImportRow {
  if (!isEmptyRoleValue(row.data.secondary_license_role)) {
    return row;
  }
  const filteredErrors = row.errors.filter(
    (e) => !e.toLowerCase().includes("secondary_license_role")
  );
  if (filteredErrors.length === row.errors.length) {
    return row;
  }
  return { ...row, errors: filteredErrors };
}

// Returns true if the row has errors that count toward Invalid status.
// For members import: secondary_license_role errors on rows with a missing/
// placeholder secondary value are ignored — those rows should be Ready.
function hasRealErrors(row: ImportRow, isMembersImport: boolean): boolean {
  if (row.errors.length === 0) {
    return false;
  }
  if (!isMembersImport) {
    return true;
  }
  // If secondary is a missing/placeholder value, strip secondary errors before
  // deciding. This is a belt-and-suspenders check alongside the suppression
  // that already runs in effectivePreviewRows.
  if (isEmptyRoleValue(row.data["secondary_license_role"])) {
    return row.errors.some(
      (e) => !e.toLowerCase().includes("secondary_license_role")
    );
  }
  return true;
}

// Get display status for a row, considering role overrides
function getRowDisplayStatus(
  row: ImportRow,
  action: RowAction,
  isMembersImport: boolean
): RowDisplayStatus {
  if (action === "skip") {
    return "skipped";
  }
  if (isMembersImport) {
    // Primary role-issue check (invalid values, constraint violations)
    if (hasRoleIssue(row)) {
      return "review";
    }
    // Belt-and-suspenders: catch same-role conflict even if hasRoleIssue misses it
    const p = getTrimmedRoleValue(row, "primary_license_role");
    const s = getTrimmedRoleValue(row, "secondary_license_role");
    if (
      p &&
      s &&
      isValidLicenseRole(p) &&
      isValidLicenseRole(s) &&
      normalizeRoleInput(p) === normalizeRoleInput(s)
    ) {
      return "review";
    }
  }
  if (hasRealErrors(row, isMembersImport)) {
    return "invalid";
  }
  if (row.duplicate) {
    return "duplicate";
  }
  return "ready";
}

// Map display status to filter category for counts/buttons
function getFilterCategory(status: RowDisplayStatus): PreviewFilter {
  // Review rows are counted as invalid for filter buttons
  if (status === "review") return "invalid";
  return status;
}

function buildSummary(
  rows: ImportRow[],
  actions: Record<number, RowAction>,
  isMembersImport: boolean
): SummaryCounts {
  const summary: SummaryCounts = {
    total: rows.length,
    ready: 0,
    duplicate: 0,
    invalid: 0,
    skipped: 0,
  };
  for (const row of rows) {
    const action = actions[row.row_index] ?? "create";
    const status = getRowDisplayStatus(row, action, isMembersImport);
    const filterCategory = getFilterCategory(status);
    summary[filterCategory] += 1;
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
  const clubT = useTranslations("ClubAdmin");

  const [step, setStep] = useState<WizardStep>("source");
  const [importType, setImportType] = useState<ImportType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [actions, setActions] = useState<Record<number, RowAction>>({});
  const [roleOverrides, setRoleOverrides] = useState<Record<number, RowRoleOverride>>({});
  const [roleConfirm, setRoleConfirm] = useState<{
    rowIndex: number;
    field: "primary_license_role" | "secondary_license_role";
    newValue: string;
    memberName: string;
    fieldLabel: string;
    roleLabel: string;
  } | null>(null);
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
  const [rewritePolicy, setRewritePolicy] = useState<LtfLicensePrefixRewritePolicy | null>(null);
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

  // Compute effective preview rows: suppress placeholder secondary errors,
  // then apply any user-provided role overrides, then guarantee the
  // "must differ" error is present whenever both roles are identical valid values.
  const effectivePreviewRows = useMemo(() => {
    if (!isMembersImport) {
      return previewRows;
    }
    return previewRows.map((row) => {
      // Always suppress secondary errors for missing/placeholder secondary values
      // so those rows show as Ready (not Invalid) when no other errors exist.
      const suppressed = suppressMissingSecondaryErrors(row);
      const override = roleOverrides[suppressed.row_index];

      let processed: typeof suppressed;
      if (!override) {
        processed = suppressed;
      } else {
        const newErrors = applyRoleOverrides(suppressed, override);
        processed = {
          ...suppressed,
          errors: newErrors,
          data: {
            ...suppressed.data,
            ...(override.primary_license_role !== undefined && {
              primary_license_role: override.primary_license_role,
            }),
            ...(override.secondary_license_role !== undefined && {
              secondary_license_role: override.secondary_license_role,
            }),
          },
        };
      }

      // Always guarantee a "must differ" error when both effective role values
      // are the same non-empty valid role — independent of the backend and of
      // whether any override was applied. This is the single authoritative
      // source of truth for same-role conflict detection.
      const effP = getTrimmedRoleValue(processed, "primary_license_role");
      const effS = getTrimmedRoleValue(processed, "secondary_license_role");
      if (
        effP &&
        effS &&
        isValidLicenseRole(effP) &&
        isValidLicenseRole(effS) &&
        normalizeRoleInput(effP) === normalizeRoleInput(effS)
      ) {
        const alreadyFlagged = processed.errors.some((e) =>
          e.toLowerCase().includes("must differ from primary")
        );
        if (!alreadyFlagged) {
          processed = {
            ...processed,
            errors: [
              ...processed.errors,
              "secondary_license_role must differ from primary_license_role",
            ],
          };
        }
      }

      return processed;
    });
  }, [previewRows, roleOverrides, isMembersImport]);

  const summary = useMemo(
    () => buildSummary(effectivePreviewRows, actions, isMembersImport),
    [actions, effectivePreviewRows, isMembersImport]
  );

  const filteredPreviewRows = useMemo(() => {
    if (previewFilter === "all") {
      return effectivePreviewRows;
    }
    return effectivePreviewRows.filter((row) => {
      const action = actions[row.row_index] ?? "create";
      const status = getRowDisplayStatus(row, action, isMembersImport);
      const filterCategory = getFilterCategory(status);
      return filterCategory === previewFilter;
    });
  }, [actions, previewFilter, effectivePreviewRows, isMembersImport]);

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
    setRoleOverrides({});
    setPreviewFilter("all");
    setIsPreviewDirty(false);
    setHasPreviewRun(false);
    setErrorMessage(null);
    setResult(null);
    setRewritePolicy(null);
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
    setRoleOverrides({});
    setPreviewFilter("all");
    setIsPreviewDirty(false);
    setHasPreviewRun(false);
    setErrorMessage(null);
    setResult(null);
    setRewritePolicy(null);
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
      setRewritePolicy(isMembersImport ? preview.ltf_license_prefix_rewrite ?? null : null);
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
      setRewritePolicy(isMembersImport ? preview.ltf_license_prefix_rewrite ?? null : null);
      setRoleOverrides({}); // Clear role overrides on new preview
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
      const rowOverrides = isMembersImport
        ? buildConfirmRowOverrides(effectivePreviewRows, roleOverrides, actions)
        : undefined;
      const importResult = await confirmImport(
        importType,
        file,
        mapping,
        actionList,
        selectedClubId ?? undefined,
        isMembersImport ? dateFormat : undefined,
        rowOverrides
      );
      setResult(importResult);
      setRewritePolicy(isMembersImport ? importResult.ltf_license_prefix_rewrite ?? rewritePolicy : null);
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

  // Apply a confirmed role override (called after user confirms the modal)
  const applyRoleOverride = (
    rowIndex: number,
    field: "primary_license_role" | "secondary_license_role",
    value: string
  ) => {
    setRoleOverrides((previous) => ({
      ...previous,
      [rowIndex]: {
        ...previous[rowIndex],
        [field]: value === "__none__" ? "" : value,
      },
    }));
  };

  const runBulkSkipInvalid = () => {
    setActions((previous) => {
      const next = { ...previous };
      for (const row of effectivePreviewRows) {
        const action = next[row.row_index] ?? "create";
        const status = getRowDisplayStatus(row, action, isMembersImport);
        // Skip rows that are invalid (including review status mapped to invalid)
        if (status === "invalid" || status === "review") {
          next[row.row_index] = "skip";
        }
      }
      return next;
    });
  };

  const runBulkCreateReady = () => {
    setActions((previous) => {
      const next = { ...previous };
      for (const row of effectivePreviewRows) {
        const currentAction = next[row.row_index] ?? "create";
        const status = getRowDisplayStatus(row, currentAction, isMembersImport);
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

  const prefixNotice =
    isMembersImport && rewritePolicy ? (
      <PageNotice tone="info">
        {rewritePolicy.enabled
          ? t("ltfPrefixRewriteEnabledNotice", {
              source: rewritePolicy.source_prefix,
              target: rewritePolicy.target_prefix,
            })
          : t("ltfPrefixRewriteDisabledNotice")}
        {rewritePolicy.enabled && rewritePolicy.rewritten_count > 0
          ? ` ${t("ltfPrefixRewriteAppliedCount", {
              count: rewritePolicy.rewritten_count,
              source: rewritePolicy.source_prefix,
              target: rewritePolicy.target_prefix,
            })}`
          : null}
      </PageNotice>
    ) : null;

  return (
    <div className="space-y-4">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

      <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {stepOrder.map((stepItem, index) => {
            const isCurrent = stepItem === step;
            const isDone = index < currentStepIndex;
            return (
              <span
                key={stepItem}
                className={`inline-flex items-center gap-2 rounded-[var(--radius-form)] border px-3 py-1 text-xs font-medium ${
                  isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : isDone
                    ? "badge-success"
                    : "border-border bg-secondary text-muted"
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
        <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">
          {step === "source" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{t("sourceStepTitle")}</h2>
                <p className="text-sm text-muted">{t("sourceStepSubtitle")}</p>
              </div>
              {prefixNotice}

              {canSwitchType ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("importTypeLabel")}</label>
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
                    <label className="text-sm font-medium text-foreground">{t("clubLabel")}</label>
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
                      <div className="rounded-[var(--radius-form)] border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                        {selectedClubName ?? "-"}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("dateFormatLabel")}</label>
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
                <label className="text-sm font-medium text-foreground">{t("fileLabel")}</label>
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
                  <span className="text-sm text-muted">
                    {file ? file.name : t("noFileSelected")}
                  </span>
                </div>
              </div>

              {file ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-secondary p-3 text-sm text-foreground">
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
                  <p className="text-sm font-medium text-foreground">{t("sampleRowsTitle")}</p>
                  <div className="max-h-72 overflow-auto rounded-[var(--radius-form)] border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary text-left text-xs uppercase text-muted">
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
                          <tr key={`${index}-${row.join("|")}`} className="border-t border-border text-foreground">
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
                <h2 className="text-lg font-semibold text-foreground">{t("mappingStepTitle")}</h2>
                <p className="text-sm text-muted">{t("mappingStepSubtitle")}</p>
              </div>
              {prefixNotice}

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

              <div className="max-h-[520px] overflow-auto rounded-[var(--radius-form)] border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t("targetFieldLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("requiredFieldLabel")}</th>
                      <th className="px-3 py-2 font-medium">{t("sourceColumnLabel")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentFields.map((field) => (
                      <tr key={field.key} className="border-t border-border text-foreground">
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

              <p className="text-sm text-muted">
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
                <h2 className="text-lg font-semibold text-foreground">{t("previewStepTitle")}</h2>
                <p className="text-sm text-muted">{t("previewStepSubtitle")}</p>
              </div>
              {prefixNotice}

              {isPreviewDirty ? (
                <p className="rounded-[var(--radius-form)] border px-3 py-2 text-sm banner-warning">
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
                      className={`inline-flex items-center rounded-[var(--radius-form)] border px-2.5 py-1 text-xs font-medium ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-foreground hover:bg-secondary"
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

              <div className="max-h-[520px] overflow-auto rounded-[var(--radius-form)] border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-left text-xs uppercase text-muted">
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
                      const status = getRowDisplayStatus(row, action, isMembersImport);
                      const isReview = status === "review";
                      const override = roleOverrides[row.row_index];

                      // Get current CSV value for a role field
                      const getCsvRoleValue = (field: "primary_license_role" | "secondary_license_role"): string => {
                        const rawValue = row.data[field];
                        return rawValue ?? "";
                      };

                      // Get default value for dropdown: CSV value if normalizable to enum, else empty
                      const getDefaultRoleValue = (field: "primary_license_role" | "secondary_license_role"): string => {
                        const csvValue = getCsvRoleValue(field);
                        if (!csvValue) return "__none__";
                        return canonicalizeLicenseRole(csvValue) || "__none__";
                      };

                      // Current values (override takes precedence, then CSV, then empty)
                      const primaryValue = override?.primary_license_role !== undefined
                        ? (override.primary_license_role || "__none__")
                        : getDefaultRoleValue("primary_license_role");
                      const secondaryValue = override?.secondary_license_role !== undefined
                        ? (override.secondary_license_role || "__none__")
                        : getDefaultRoleValue("secondary_license_role");

                      // Secondary is disabled until primary is set
                      const primarySelected = primaryValue !== "__none__" && primaryValue !== "";

                      // Detect same-role conflict directly from effective row data.
                      // row.data already has overrides baked in (via effectivePreviewRows), so
                      // this check is 100% reliable regardless of display values or isReview.
                      const hasSameRoles = isMembersImport && (() => {
                        const p = getTrimmedRoleValue(row, "primary_license_role");
                        const s = getTrimmedRoleValue(row, "secondary_license_role");
                        return Boolean(
                          p && s &&
                          isValidLicenseRole(p) &&
                          isValidLicenseRole(s) &&
                          normalizeRoleInput(p) === normalizeRoleInput(s)
                        );
                      })();

                      // Available secondary options exclude the selected primary
                      const secondaryOptions = LICENSE_ROLE_VALUES.filter(
                        (role) => role.toLowerCase() !== String(primaryValue).toLowerCase()
                      );

                      return (
                        <tr key={row.row_index} className="border-t border-border text-foreground">
                          <td className="px-2 py-2">{row.row_index}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`inline-flex rounded-[var(--radius-form)] border px-2 py-0.5 text-xs font-medium ${
                                status === "ready"
                                  ? "badge-success"
                                  : status === "duplicate"
                                  ? "badge-warning"
                                  : status === "invalid"
                                  ? "badge-danger"
                                  : status === "review"
                                  ? "badge-warning"
                                  : "border-border bg-secondary text-foreground"
                              }`}
                            >
                              {status === "ready"
                                ? t("statusReady")
                                : status === "duplicate"
                                ? t("statusDuplicate")
                                : status === "invalid"
                                ? t("statusInvalid")
                                : status === "review"
                                ? t("statusReview")
                                : t("statusSkipped")}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {Object.entries(row.data)
                              .filter(([, value]) => value !== null && value !== "")
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(", ")}
                          </td>
                          <td className="px-2 py-2 text-xs text-destructive">
                            {row.errors.join(", ")}
                            {row.duplicate ? ` ${t("duplicateHint")}` : ""}
                            {hasSameRoles && (
                              <span>
                                {row.errors.length > 0 || row.duplicate ? " — " : ""}
                                {t("roleConflictError")}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex min-w-[11rem] flex-col gap-2">
                              {isReview && isMembersImport ? (
                                <div className="rounded-[var(--radius-form)] border border-border bg-secondary p-2">
                                  <p className="mb-2 text-xs font-medium text-foreground">
                                    {t("roleCorrectionLabel")}
                                  </p>
                                  <div className="space-y-2">
                                    <div className="space-y-1">
                                      <label className="block text-xs text-muted">
                                        {t("primaryLicenseRoleLabel")}:
                                      </label>
                                      <Select
                                        value={primaryValue}
                                        onValueChange={(value) => {
                                          const name =
                                            [row.data.first_name, row.data.last_name]
                                              .filter(Boolean)
                                              .join(" ") || `#${row.row_index}`;
                                          const rLabel =
                                            value === "__none__"
                                              ? clubT("roleNoneOption")
                                              : clubT(licenseRoleMessageKey(value));
                                          setRoleConfirm({
                                            rowIndex: row.row_index,
                                            field: "primary_license_role",
                                            newValue: value,
                                            memberName: name,
                                            fieldLabel: t("primaryLicenseRoleLabel"),
                                            roleLabel: rLabel,
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="h-8 w-full rounded-[var(--radius-form)] text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__none__">{clubT("roleNoneOption")}</SelectItem>
                                          {LICENSE_ROLE_VALUES.map((role) => (
                                            <SelectItem key={role} value={role}>
                                              {clubT(licenseRoleMessageKey(role))}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="block text-xs text-muted">
                                        {t("secondaryLicenseRoleLabel")}:
                                      </label>
                                      <Select
                                        value={secondaryValue}
                                        onValueChange={(value) => {
                                          const name =
                                            [row.data.first_name, row.data.last_name]
                                              .filter(Boolean)
                                              .join(" ") || `#${row.row_index}`;
                                          const rLabel =
                                            value === "__none__"
                                              ? clubT("roleNoneOption")
                                              : clubT(licenseRoleMessageKey(value));
                                          setRoleConfirm({
                                            rowIndex: row.row_index,
                                            field: "secondary_license_role",
                                            newValue: value,
                                            memberName: name,
                                            fieldLabel: t("secondaryLicenseRoleLabel"),
                                            roleLabel: rLabel,
                                          });
                                        }}
                                        disabled={!primarySelected}
                                      >
                                        <SelectTrigger
                                          className={`h-8 w-full rounded-[var(--radius-form)] text-xs ${!primarySelected ? "opacity-50" : ""}`}
                                        >
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__none__">{clubT("roleNoneOption")}</SelectItem>
                                          {secondaryOptions.map((role) => (
                                            <SelectItem key={role} value={role}>
                                              {clubT(licenseRoleMessageKey(role))}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    {hasSameRoles ? (
                                      <p className="text-xs font-medium text-destructive">
                                        {t("roleConflictError")}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                              <Select
                                value={hasSameRoles ? "skip" : action}
                                onValueChange={(value) => {
                                  if (!hasSameRoles) setRowAction(row.row_index, value);
                                }}
                                disabled={hasSameRoles}
                              >
                                <SelectTrigger className={`w-full ${hasSameRoles ? "opacity-50" : ""}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="create">{t("createAction")}</SelectItem>
                                  <SelectItem value="skip">{t("skipAction")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Role change confirmation modal */}
          {roleConfirm && (
            <Modal
              isOpen={true}
              onClose={() => setRoleConfirm(null)}
              title={t("roleChangeConfirmTitle")}
            >
              <p className="text-sm text-muted">
                {t.rich("roleChangeConfirmBody", {
                  field: roleConfirm.fieldLabel,
                  name: roleConfirm.memberName,
                  role: roleConfirm.roleLabel,
                  b: (chunks) => (
                    <strong className="font-semibold text-foreground">{chunks}</strong>
                  ),
                })}
              </p>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Button variant="outline" onClick={() => setRoleConfirm(null)}>
                  {t("cancelAndBack")}
                </Button>
                <Button
                  onClick={() => {
                    applyRoleOverride(roleConfirm.rowIndex, roleConfirm.field, roleConfirm.newValue);
                    setRoleConfirm(null);
                  }}
                >
                  {t("roleChangeApply")}
                </Button>
              </div>
            </Modal>
          )}

          {step === "confirm" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{t("confirmStepTitle")}</h2>
                <p className="text-sm text-muted">{t("confirmStepSubtitle")}</p>
              </div>
              {prefixNotice}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius-form)] border border-border bg-secondary px-3 py-2 text-sm text-foreground">
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
                <div className="rounded-[var(--radius-form)] border border-border bg-secondary px-3 py-2 text-sm text-foreground">
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

              <p className="banner-notice rounded-[var(--radius-form)] border px-3 py-2 text-sm">
                {t("confirmWarning")}
              </p>
            </div>
          ) : null}

          {step === "result" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{t("resultStepTitle")}</h2>
                <p className="text-sm text-muted">{t("resultStepSubtitle")}</p>
              </div>
              {prefixNotice}

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[var(--radius-form)] border px-3 py-2 text-sm banner-success">
                  <span className="font-medium">{t("resultCreated")}:</span> {result?.created ?? 0}
                </div>
                <div className="rounded-[var(--radius-form)] border border-border bg-secondary px-3 py-2 text-sm text-foreground">
                  <span className="font-medium">{t("resultSkipped")}:</span> {result?.skipped ?? 0}
                </div>
                <div className="rounded-[var(--radius-form)] border px-3 py-2 text-sm banner-danger">
                  <span className="font-medium">{t("resultErrors")}:</span> {result?.errors.length ?? 0}
                </div>
              </div>

              {result && result.errors.length > 0 ? (
                <div className="max-h-[340px] overflow-auto rounded-[var(--radius-form)] border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-left text-xs uppercase text-muted">
                      <tr>
                        <th className="px-2 py-2 font-medium">{t("rowLabel")}</th>
                        <th className="px-2 py-2 font-medium">{t("errorsLabel")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((item) => (
                        <tr key={`err-${item.row_index}`} className="border-t border-border text-foreground">
                          <td className="px-2 py-2">{item.row_index}</td>
                          <td className="px-2 py-2 text-destructive">{item.errors.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="rounded-[var(--radius-card)] bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">{t("summaryTitle")}</h3>
          <div className="mt-3 space-y-2 text-sm text-foreground">
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
            className={`mt-4 rounded-[var(--radius-form)] border px-3 py-2 text-xs ${
              summaryPreviewState === "stale"
                ? "banner-warning"
                : summaryPreviewState === "current"
                ? "banner-success"
                : summaryPreviewState === "ready"
                ? "banner-info"
                : "border-border bg-secondary text-foreground"
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

      <section className="rounded-[var(--radius-card)] bg-card p-4 shadow-sm">
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
                {common("paginationPrevious")}
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
