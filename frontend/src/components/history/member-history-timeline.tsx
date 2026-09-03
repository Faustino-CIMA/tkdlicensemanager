"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { ActionNotices } from "@/components/ui/list-page-chrome";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GradeHistoryEntry, LicenseHistoryEvent } from "@/lib/ltf-admin-api";
import { formatDisplayDate } from "@/lib/date-display";

const ROWS_PER_PAGE = 5;

const GRADE_OPTIONS = [
  "10th Kup",
  "9th Kup",
  "8th Kup",
  "7th Kup",
  "6th Kup",
  "5th Kup",
  "4th Kup",
  "3rd Kup",
  "2nd Kup",
  "1st Kup",
  "1st Poom",
  "2nd Poom",
  "1st Dan",
  "2nd Dan",
  "3rd Dan",
  "4th Dan",
  "5th Dan",
  "6th Dan",
  "7th Dan",
  "8th Dan",
  "9th Dan",
] as const;

type IssuedByOption = "club" | "ltf" | "other";

export type GradeFormInput = {
  to_grade: string;
  promotion_date?: string;
  created_by: string;
};

type HistoryTimelineProps = {
  licenseTitle: string;
  gradeTitle: string;
  emptyLabel: string;
  licenseYearLabel: string;
  licenseTypeLabel: string;
  licenseStatusLabel: string;
  licenseIssuedLabel: string;
  gradeDateLabel: string;
  gradeLabel: string;
  gradeIssuedByLabel: string;
  addGradeAriaLabel?: string;
  editGradeAriaLabel?: string;
  deleteGradeAriaLabel?: string;
  deleteGradeTitle?: string;
  deleteGradeDescription?: string;
  deleteConfirmLabel?: string;
  gradeFormTitle?: string;
  editGradeFormTitle?: string;
  promoteToGradeLabel?: string;
  promoteDateLabel?: string;
  issuedByLabel?: string;
  issuedByClubOption?: string;
  issuedByLtfOption?: string;
  issuedByOtherOption?: string;
  issuedByOtherPlaceholder?: string;
  promoteSubmitLabel?: string;
  cancelLabel?: string;
  previousPageLabel?: string;
  nextPageLabel?: string;
  pageLabel?: string;
  onPromote?: (input: GradeFormInput) => Promise<void>;
  onUpdateGrade?: (id: number, input: GradeFormInput) => Promise<void>;
  onDeleteGrade?: (id: number) => Promise<void>;
  licenseHistory: LicenseHistoryEvent[];
  gradeHistory: GradeHistoryEntry[];
  visibleSection?: "all" | "licenses" | "grades";
};

function humanizeStatus(value: string): string {
  if (!value) {
    return "-";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderLicenseStatusBadge(status: string) {
  const normalized = status.trim().toLowerCase();
  const label = humanizeStatus(status);
  if (!normalized) {
    return "-";
  }
  if (normalized === "active") {
    return <StatusBadge label={label} tone="success" />;
  }
  if (normalized === "pending") {
    return <StatusBadge label={label} tone="warning" />;
  }
  if (normalized === "revoked") {
    return <StatusBadge label={label} tone="danger" />;
  }
  if (normalized === "expired") {
    return <StatusBadge label={label} tone="neutral" />;
  }
  return <StatusBadge label={label} tone="neutral" />;
}

function parseIssuedBy(createdBy: string): { option: IssuedByOption; otherText: string } {
  const normalized = createdBy.trim();
  if (normalized.toLowerCase() === "club") {
    return { option: "club", otherText: "" };
  }
  if (normalized.toLowerCase() === "ltf") {
    return { option: "ltf", otherText: "" };
  }
  if (!normalized) {
    return { option: "club", otherText: "" };
  }
  return { option: "other", otherText: normalized };
}

function resolveCreatedBy(option: IssuedByOption, otherText: string): string {
  if (option === "club") {
    return "Club";
  }
  if (option === "ltf") {
    return "LTF";
  }
  return otherText.trim();
}

function isOfficialGrade(value: string): boolean {
  return (GRADE_OPTIONS as readonly string[]).includes(value);
}

function isActiveLicenseStatus(status: string): boolean {
  return status.trim().toLowerCase() === "active";
}

function compareLicenseEventsForDedup(a: LicenseHistoryEvent, b: LicenseHistoryEvent): number {
  const aActive = isActiveLicenseStatus(a.status_after);
  const bActive = isActiveLicenseStatus(b.status_after);
  if (aActive !== bActive) {
    return aActive ? -1 : 1;
  }
  return b.event_at.localeCompare(a.event_at);
}

function deduplicateLicenseHistory(events: LicenseHistoryEvent[]): LicenseHistoryEvent[] {
  const bestByYear = new Map<number, LicenseHistoryEvent>();
  for (const event of events) {
    const existing = bestByYear.get(event.license_year);
    if (!existing || compareLicenseEventsForDedup(event, existing) < 0) {
      bestByYear.set(event.license_year, event);
    }
  }
  return Array.from(bestByYear.values());
}

type HistoryTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
};

function HistoryEntityTable<T extends { id: number | string }>({
  columns,
  rows,
  rowClassName,
  cellClassName,
}: {
  columns: Array<HistoryTableColumn<T>>;
  rows: T[];
  rowClassName: string;
  cellClassName: string;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-card shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border bg-secondary text-xs uppercase text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-4 py-3 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className={`text-foreground ${rowClassName}`}>
              {columns.map((column) => (
                <td key={column.key} className={cellClassName}>
                  {column.render ? column.render(row) : (row as Record<string, React.ReactNode>)[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryPagination({
  currentPage,
  totalPages,
  onPrevious,
  onNext,
  previousPageLabel,
  nextPageLabel,
}: {
  currentPage: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
  previousPageLabel: string;
  nextPageLabel: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-[var(--control-height)] min-h-[var(--control-height)] shrink-0"
        disabled={currentPage <= 1}
        onClick={onPrevious}
      >
        {previousPageLabel}
      </Button>
      <span className="flex-1 text-center text-xs text-muted">
        {currentPage} / {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        className="h-[var(--control-height)] min-h-[var(--control-height)] shrink-0"
        disabled={currentPage >= totalPages}
        onClick={onNext}
      >
        {nextPageLabel}
      </Button>
    </div>
  );
}

function GradeInlineForm({
  editingGradeId,
  gradeFormTitle,
  editGradeFormTitle,
  promoteDateLabel,
  promoteToGradeLabel,
  issuedByLabel,
  issuedByClubOption,
  issuedByLtfOption,
  issuedByOtherOption,
  issuedByOtherPlaceholder,
  promoteSubmitLabel,
  cancelLabel,
  gradeOptions,
  toGrade,
  promotionDate,
  issuedByOption,
  issuedByOther,
  isSubmitting,
  onToGradeChange,
  onPromotionDateChange,
  onIssuedByOptionChange,
  onIssuedByOtherChange,
  onSubmit,
  onCancel,
}: {
  editingGradeId: number | null;
  gradeFormTitle?: string;
  editGradeFormTitle?: string;
  promoteDateLabel?: string;
  promoteToGradeLabel?: string;
  issuedByLabel?: string;
  issuedByClubOption?: string;
  issuedByLtfOption?: string;
  issuedByOtherOption?: string;
  issuedByOtherPlaceholder?: string;
  promoteSubmitLabel?: string;
  cancelLabel?: string;
  gradeOptions: string[];
  toGrade: string;
  promotionDate: string;
  issuedByOption: IssuedByOption;
  issuedByOther: string;
  isSubmitting: boolean;
  onToGradeChange: (value: string) => void;
  onPromotionDateChange: (value: string) => void;
  onIssuedByOptionChange: (value: IssuedByOption) => void;
  onIssuedByOtherChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-form)] border border-border bg-secondary/20 p-4">
      <p className="text-sm font-semibold text-foreground">
        {editingGradeId !== null ? editGradeFormTitle ?? gradeFormTitle : gradeFormTitle}
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="grade-promotion-date">{promoteDateLabel}</Label>
          <Input
            id="grade-promotion-date"
            type="date"
            className="rounded-[var(--radius-form)]"
            value={promotionDate}
            onChange={(event) => onPromotionDateChange(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade-to-rank">{promoteToGradeLabel}</Label>
          <Select value={toGrade || undefined} onValueChange={onToGradeChange}>
            <SelectTrigger id="grade-to-rank" className="rounded-[var(--radius-form)]">
              <SelectValue placeholder={promoteToGradeLabel} />
            </SelectTrigger>
            <SelectContent>
              {gradeOptions.map((grade) => (
                <SelectItem key={grade} value={grade}>
                  {grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade-issued-by">{issuedByLabel}</Label>
          <Select
            value={issuedByOption}
            onValueChange={(value) => onIssuedByOptionChange(value as IssuedByOption)}
          >
            <SelectTrigger id="grade-issued-by" className="rounded-[var(--radius-form)]">
              <SelectValue placeholder={issuedByLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="club">{issuedByClubOption}</SelectItem>
              <SelectItem value="ltf">{issuedByLtfOption}</SelectItem>
              <SelectItem value="other">{issuedByOtherOption}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {issuedByOption === "other" ? (
          <div className="space-y-2">
            <Label htmlFor="grade-issued-by-other">{issuedByOtherPlaceholder}</Label>
            <Input
              id="grade-issued-by-other"
              className="rounded-[var(--radius-form)]"
              value={issuedByOther}
              onChange={(event) => onIssuedByOtherChange(event.target.value)}
              placeholder={issuedByOtherPlaceholder}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" className="h-[var(--control-height)] min-h-[var(--control-height)]" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" className="h-[var(--control-height)] min-h-[var(--control-height)]" disabled={isSubmitting} onClick={onSubmit}>
          {promoteSubmitLabel}
        </Button>
      </div>
    </div>
  );
}

export function MemberHistoryTimeline({
  licenseTitle,
  gradeTitle,
  emptyLabel,
  licenseYearLabel,
  licenseTypeLabel,
  licenseStatusLabel,
  licenseIssuedLabel,
  gradeDateLabel,
  gradeLabel,
  gradeIssuedByLabel,
  addGradeAriaLabel,
  editGradeAriaLabel,
  deleteGradeAriaLabel,
  deleteGradeTitle,
  deleteGradeDescription,
  deleteConfirmLabel,
  gradeFormTitle,
  editGradeFormTitle,
  promoteToGradeLabel,
  promoteDateLabel,
  issuedByLabel,
  issuedByClubOption,
  issuedByLtfOption,
  issuedByOtherOption,
  issuedByOtherPlaceholder,
  promoteSubmitLabel,
  cancelLabel,
  previousPageLabel = "Previous page",
  nextPageLabel = "Next page",
  onPromote,
  onUpdateGrade,
  onDeleteGrade,
  licenseHistory,
  gradeHistory,
  visibleSection = "all",
}: HistoryTimelineProps) {
  const [licensePage, setLicensePage] = useState(1);
  const [gradePage, setGradePage] = useState(1);
  const [gradeFormOpen, setGradeFormOpen] = useState(false);
  const [editingGradeId, setEditingGradeId] = useState<number | null>(null);
  const [selectedGradeId, setSelectedGradeId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [toGrade, setToGrade] = useState("");
  const [promotionDate, setPromotionDate] = useState("");
  const [issuedByOption, setIssuedByOption] = useState<IssuedByOption>("club");
  const [issuedByOther, setIssuedByOther] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const gradeOptions = [...GRADE_OPTIONS];

  const sortedLicenses = useMemo(
    () =>
      deduplicateLicenseHistory(licenseHistory).sort((a, b) => b.license_year - a.license_year),
    [licenseHistory]
  );
  const sortedGrades = useMemo(
    () =>
      [...gradeHistory].sort((a, b) => {
        const dateCompare = b.promotion_date.localeCompare(a.promotion_date);
        if (dateCompare !== 0) {
          return dateCompare;
        }
        return b.id - a.id;
      }),
    [gradeHistory]
  );

  const licenseTotalPages = Math.max(1, Math.ceil(sortedLicenses.length / ROWS_PER_PAGE));
  const gradeTotalPages = Math.max(1, Math.ceil(sortedGrades.length / ROWS_PER_PAGE));

  useEffect(() => {
    setLicensePage((page) => Math.min(Math.max(1, page), licenseTotalPages));
  }, [licenseTotalPages, sortedLicenses.length]);

  useEffect(() => {
    setGradePage((page) => Math.min(Math.max(1, page), gradeTotalPages));
  }, [gradeTotalPages, sortedGrades.length]);

  useEffect(() => {
    if (selectedGradeId !== null && !sortedGrades.some((entry) => entry.id === selectedGradeId)) {
      setSelectedGradeId(null);
    }
  }, [sortedGrades, selectedGradeId]);

  const paginatedLicenses = sortedLicenses.slice(
    (licensePage - 1) * ROWS_PER_PAGE,
    licensePage * ROWS_PER_PAGE
  );
  const paginatedGrades = sortedGrades.slice((gradePage - 1) * ROWS_PER_PAGE, gradePage * ROWS_PER_PAGE);

  const canManageGrades = Boolean(onPromote || onUpdateGrade || onDeleteGrade);
  const canSelectGrades = Boolean(onUpdateGrade || onDeleteGrade);

  const gradeTableColumns = useMemo(() => {
    const columns: Array<HistoryTableColumn<GradeHistoryEntry>> = [
      {
        key: "date",
        header: gradeDateLabel,
        render: (row) => formatDisplayDate(row.promotion_date),
      },
      {
        key: "grade",
        header: gradeLabel,
        render: (row) => row.to_grade,
      },
      {
        key: "issuedBy",
        header: gradeIssuedByLabel,
        render: (row) => row.created_by || "-",
      },
    ];

    if (canSelectGrades) {
      columns.push({
        key: "select",
        header: <span className="sr-only">Select</span>,
        render: (row) => (
          <span
            className="inline-flex min-h-11 min-w-11 items-center justify-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selectedGradeId === row.id}
              onCheckedChange={(checked) => {
                setSelectedGradeId(checked === true ? row.id : null);
              }}
              aria-label={`Select grade ${row.to_grade}`}
            />
          </span>
        ),
      });
    }

    return columns;
  }, [canSelectGrades, gradeDateLabel, gradeIssuedByLabel, gradeLabel, selectedGradeId]);

  const resetGradeForm = () => {
    setToGrade("");
    setPromotionDate("");
    setIssuedByOption("club");
    setIssuedByOther("");
    setEditingGradeId(null);
    setErrorMessage(null);
  };

  const closeGradeForm = () => {
    setGradeFormOpen(false);
    resetGradeForm();
  };

  const openAddGradeForm = () => {
    resetGradeForm();
    setGradeFormOpen(true);
  };

  const openEditGradeForm = (entry: GradeHistoryEntry) => {
    const parsedIssuedBy = parseIssuedBy(entry.created_by ?? "");
    setEditingGradeId(entry.id);
    setToGrade(isOfficialGrade(entry.to_grade) ? entry.to_grade : "");
    setPromotionDate(entry.promotion_date);
    setIssuedByOption(parsedIssuedBy.option);
    setIssuedByOther(parsedIssuedBy.otherText);
    setErrorMessage(null);
    setGradeFormOpen(true);
  };

  const openEditSelectedGrade = () => {
    if (selectedGradeId === null) {
      return;
    }
    const entry = sortedGrades.find((grade) => grade.id === selectedGradeId);
    if (entry) {
      openEditGradeForm(entry);
    }
  };

  const openDeleteSelectedGrade = () => {
    if (selectedGradeId === null || !onDeleteGrade) {
      return;
    }
    setErrorMessage(null);
    setPendingDeleteId(selectedGradeId);
  };

  const confirmDeleteSelectedGrade = async () => {
    if (pendingDeleteId === null || !onDeleteGrade) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onDeleteGrade(pendingDeleteId);
      if (editingGradeId === pendingDeleteId) {
        closeGradeForm();
      }
      setSelectedGradeId(null);
      setPendingDeleteId(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete grade.");
      setPendingDeleteId(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitGradeForm = async () => {
    const createdBy = resolveCreatedBy(issuedByOption, issuedByOther);
    if (!toGrade.trim()) {
      setErrorMessage("Grade is required.");
      return;
    }
    if (!isOfficialGrade(toGrade.trim())) {
      setErrorMessage("Grade must be a standard belt rank.");
      return;
    }
    if (issuedByOption === "other" && !issuedByOther.trim()) {
      setErrorMessage("Please enter who issued this grade.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const payload: GradeFormInput = {
        to_grade: toGrade.trim(),
        promotion_date: promotionDate || undefined,
        created_by: createdBy,
      };
      if (editingGradeId !== null && onUpdateGrade) {
        await onUpdateGrade(editingGradeId, payload);
      } else if (onPromote) {
        await onPromote(payload);
      }
      closeGradeForm();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save grade.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const showLicenses = visibleSection === "all" || visibleSection === "licenses";
  const showGrades = visibleSection === "all" || visibleSection === "grades";
  const showSectionTitles = visibleSection === "all";

  return (
    <section className="space-y-6">
      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />
      {showLicenses ? (
      <div>
        {showSectionTitles ? (
          <h3 className="text-lg font-semibold text-foreground">{licenseTitle}</h3>
        ) : null}
        {sortedLicenses.length === 0 ? (
          <p className={showSectionTitles ? "mt-2 text-sm text-muted" : "text-sm text-muted"}>{emptyLabel}</p>
        ) : (
          <div className={showSectionTitles ? "mt-3" : undefined}>
            <HistoryEntityTable
              columns={[
                { key: "year", header: licenseYearLabel, render: (row) => row.license_year },
                {
                  key: "type",
                  header: licenseTypeLabel,
                  render: (row) => row.license_type_name || "-",
                },
                {
                  key: "status",
                  header: licenseStatusLabel,
                  render: (row) => renderLicenseStatusBadge(row.status_after),
                },
                {
                  key: "issued",
                  header: licenseIssuedLabel,
                  render: (row) => formatDisplayDate(row.event_at),
                },
              ]}
              rows={paginatedLicenses}
              rowClassName="h-[var(--table-row-height)]"
              cellClassName="box-border h-[var(--table-row-height)] px-4 py-0 align-middle"
            />
            {sortedLicenses.length > ROWS_PER_PAGE ? (
              <HistoryPagination
                currentPage={licensePage}
                totalPages={licenseTotalPages}
                onPrevious={() => setLicensePage((page) => Math.max(1, page - 1))}
                onNext={() => setLicensePage((page) => Math.min(licenseTotalPages, page + 1))}
                previousPageLabel={previousPageLabel}
                nextPageLabel={nextPageLabel}
              />
            ) : null}
          </div>
        )}
      </div>
      ) : null}

      {showGrades ? (
      <div>
        {showSectionTitles || canManageGrades ? (
        <div className="flex items-center justify-between gap-2">
          {showSectionTitles ? (
            <h3 className="text-lg font-semibold text-foreground">{gradeTitle}</h3>
          ) : (
            <span />
          )}
          {canManageGrades ? (
            <div className="flex items-center gap-2">
              {onPromote ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0"
                  aria-label={addGradeAriaLabel}
                  onClick={openAddGradeForm}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              ) : null}
              {onUpdateGrade ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0"
                  aria-label={editGradeAriaLabel}
                  disabled={selectedGradeId === null}
                  onClick={openEditSelectedGrade}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              {onDeleteGrade ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-[var(--control-height)] min-h-[var(--control-height)] w-[var(--control-height)] shrink-0"
                  aria-label={deleteGradeAriaLabel}
                  disabled={selectedGradeId === null}
                  onClick={openDeleteSelectedGrade}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        ) : null}
        {gradeFormOpen ? (
          <div className="mt-3">
            <GradeInlineForm
              editingGradeId={editingGradeId}
              gradeFormTitle={gradeFormTitle}
              editGradeFormTitle={editGradeFormTitle}
              promoteDateLabel={promoteDateLabel}
              promoteToGradeLabel={promoteToGradeLabel}
              issuedByLabel={issuedByLabel}
              issuedByClubOption={issuedByClubOption}
              issuedByLtfOption={issuedByLtfOption}
              issuedByOtherOption={issuedByOtherOption}
              issuedByOtherPlaceholder={issuedByOtherPlaceholder}
              promoteSubmitLabel={promoteSubmitLabel}
              cancelLabel={cancelLabel}
              gradeOptions={gradeOptions}
              toGrade={toGrade}
              promotionDate={promotionDate}
              issuedByOption={issuedByOption}
              issuedByOther={issuedByOther}
              isSubmitting={isSubmitting}
              onToGradeChange={setToGrade}
              onPromotionDateChange={setPromotionDate}
              onIssuedByOptionChange={setIssuedByOption}
              onIssuedByOtherChange={setIssuedByOther}
              onSubmit={submitGradeForm}
              onCancel={closeGradeForm}
            />
          </div>
        ) : sortedGrades.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{emptyLabel}</p>
        ) : (
          <div className="mt-3">
            <HistoryEntityTable
              columns={gradeTableColumns}
              rows={paginatedGrades}
              rowClassName="h-[var(--table-row-height)]"
              cellClassName="box-border h-[var(--table-row-height)] px-4 py-0 align-middle"
            />
            {sortedGrades.length > ROWS_PER_PAGE ? (
              <HistoryPagination
                currentPage={gradePage}
                totalPages={gradeTotalPages}
                onPrevious={() => setGradePage((page) => Math.max(1, page - 1))}
                onNext={() => setGradePage((page) => Math.min(gradeTotalPages, page + 1))}
                previousPageLabel={previousPageLabel}
                nextPageLabel={nextPageLabel}
              />
            ) : null}
          </div>
        )}
      </div>
      ) : null}
      <DeleteConfirmModal
        isOpen={pendingDeleteId !== null}
        title={deleteGradeTitle ?? "Delete grade"}
        description={deleteGradeDescription ?? "You are about to delete this grade promotion. This action cannot be undone."}
        confirmLabel={deleteConfirmLabel ?? "Delete"}
        cancelLabel={cancelLabel ?? "Cancel"}
        onConfirm={() => {
          void confirmDeleteSelectedGrade();
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
