"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { ClubAdminLayout } from "@/components/club-admin/club-admin-layout";
import { EmptyState } from "@/components/club-admin/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/api";
import { getClubs } from "@/lib/club-admin-api";
import {
  CardTemplate,
  PaperProfile,
  PrintJobInput,
  createPrintJob,
  executePrintJob,
  getCardTemplates,
  getPaperProfiles,
} from "@/lib/license-card-api";

const QUICK_PRINT_STORAGE_KEY = "club_quick_print_payload";
const TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE = "__template_default__";
const DEFAULT_BLEED_MM = "2.00";
const DEFAULT_SAFE_AREA_MM = "3.00";

type AuthMeResponse = {
  role: string;
};

type QuickPrintSource = "members" | "licenses";

type QuickPrintPayload = {
  source: QuickPrintSource;
  selectedClubId: number | null;
  memberIds: number[];
  licenseIds: number[];
};

function parsePositiveIds(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const values = input
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Array.from(new Set(values));
}

function parseQuickPrintPayload(): QuickPrintPayload {
  if (typeof window === "undefined") {
    return {
      source: "members",
      selectedClubId: null,
      memberIds: [],
      licenseIds: [],
    };
  }
  try {
    const rawValue = window.sessionStorage.getItem(QUICK_PRINT_STORAGE_KEY);
    if (!rawValue) {
      return {
        source: "members",
        selectedClubId: null,
        memberIds: [],
        licenseIds: [],
      };
    }
    const parsed = JSON.parse(rawValue) as {
      source?: unknown;
      selectedClubId?: unknown;
      memberIds?: unknown;
      licenseIds?: unknown;
    };
    const selectedClubId = Number(parsed.selectedClubId);
    return {
      source: parsed.source === "licenses" ? "licenses" : "members",
      selectedClubId:
        Number.isInteger(selectedClubId) && selectedClubId > 0 ? selectedClubId : null,
      memberIds: parsePositiveIds(parsed.memberIds),
      licenseIds: parsePositiveIds(parsed.licenseIds),
    };
  } catch {
    return {
      source: "members",
      selectedClubId: null,
      memberIds: [],
      licenseIds: [],
    };
  }
}

function parseNonNegativeNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export default function ClubQuickPrintPage() {
  const t = useTranslations("ClubAdmin");
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.split("/")[1] || "en";
  const [payload] = useState<QuickPrintPayload>(() => parseQuickPrintPayload());
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [paperProfiles, setPaperProfiles] = useState<PaperProfile[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<number, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedPaperProfileValue, setSelectedPaperProfileValue] = useState(
    TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE
  );
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [includeBleedGuide, setIncludeBleedGuide] = useState(false);
  const [includeSafeAreaGuide, setIncludeSafeAreaGuide] = useState(false);
  const [bleedMmInput, setBleedMmInput] = useState(DEFAULT_BLEED_MM);
  const [safeAreaMmInput, setSafeAreaMmInput] = useState(DEFAULT_SAFE_AREA_MM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canManageQuickPrint = currentRole === "club_admin";
  const selectedIds = payload.source === "licenses" ? payload.licenseIds : payload.memberIds;
  const selectedCount = selectedIds.length;

  const loadBootstrapData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [clubsResponse, templatesResponse, profilesResponse] = await Promise.all([
        getClubs(),
        getCardTemplates(),
        getPaperProfiles(),
      ]);
      setClubNameById(
        clubsResponse.reduce<Record<number, string>>((acc, club) => {
          acc[club.id] = club.name;
          return acc;
        }, {})
      );
      setTemplates(templatesResponse);
      setPaperProfiles(profilesResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("quickPrintLoadError"));
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
    if (!canManageQuickPrint) {
      return;
    }
    void loadBootstrapData();
  }, [canManageQuickPrint, loadBootstrapData]);

  const printableTemplates = useMemo(() => {
    return templates.filter((template) => Boolean(template.latest_published_version));
  }, [templates]);

  useEffect(() => {
    if (printableTemplates.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    const hasCurrentTemplate = printableTemplates.some(
      (template) => String(template.id) === selectedTemplateId
    );
    if (hasCurrentTemplate) {
      return;
    }
    const defaultTemplate =
      printableTemplates.find((template) => template.is_default) ?? printableTemplates[0];
    setSelectedTemplateId(String(defaultTemplate.id));
  }, [printableTemplates, selectedTemplateId]);

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) {
      return null;
    }
    return printableTemplates.find((template) => String(template.id) === selectedTemplateId) ?? null;
  }, [printableTemplates, selectedTemplateId]);

  const selectedVersion = selectedTemplate?.latest_published_version ?? null;

  const paperProfilesForSelectedTemplate = useMemo(() => {
    if (!selectedVersion) {
      return [];
    }
    return paperProfiles.filter((profile) => profile.card_format === selectedVersion.card_format);
  }, [paperProfiles, selectedVersion]);

  useEffect(() => {
    setSelectedPaperProfileValue(TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE);
    setSelectedSlots([]);
  }, [selectedTemplateId]);

  const selectedPaperProfile = useMemo(() => {
    if (!selectedVersion) {
      return null;
    }
    if (selectedPaperProfileValue !== TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE) {
      const selectedProfileId = Number(selectedPaperProfileValue);
      return paperProfilesForSelectedTemplate.find((profile) => profile.id === selectedProfileId) ?? null;
    }
    if (!selectedVersion.paper_profile) {
      return null;
    }
    return (
      paperProfilesForSelectedTemplate.find((profile) => profile.id === selectedVersion.paper_profile) ??
      null
    );
  }, [paperProfilesForSelectedTemplate, selectedPaperProfileValue, selectedVersion]);

  const slotCount = selectedPaperProfile ? Number(selectedPaperProfile.slot_count) : 0;
  const slotColumns = selectedPaperProfile
    ? Math.max(1, Math.min(Number(selectedPaperProfile.columns) || 1, 6))
    : 1;

  useEffect(() => {
    if (slotCount <= 0) {
      setSelectedSlots([]);
      return;
    }
    setSelectedSlots((previous) => previous.filter((slotIndex) => slotIndex < slotCount));
  }, [slotCount]);

  const hasValidSelection = Boolean(payload.selectedClubId) && selectedCount > 0;
  const backToSelectionRoute =
    payload.source === "licenses"
      ? `/${locale}/dashboard/club/licenses`
      : `/${locale}/dashboard/club/members`;

  const toggleSlotSelection = (slotIndex: number) => {
    setSelectedSlots((previous) => {
      if (previous.includes(slotIndex)) {
        return previous.filter((value) => value !== slotIndex);
      }
      return [...previous, slotIndex].sort((left, right) => left - right);
    });
  };

  const selectAllSlots = () => {
    if (slotCount <= 0) {
      return;
    }
    setSelectedSlots(Array.from({ length: slotCount }, (_, index) => index));
  };

  const clearSelectedSlots = () => {
    setSelectedSlots([]);
  };

  const handleCreateAndExecute = async () => {
    if (!canManageQuickPrint || !payload.selectedClubId || !selectedVersion) {
      return;
    }
    if (selectedSlots.length > 0 && selectedSlots.length < selectedCount) {
      setErrorMessage(
        t("quickPrintSelectedSlotsInsufficientError", {
          selected: selectedSlots.length,
          required: selectedCount,
        })
      );
      return;
    }
    const bleedMm = parseNonNegativeNumber(bleedMmInput);
    const safeAreaMm = parseNonNegativeNumber(safeAreaMmInput);
    if (bleedMm === null || safeAreaMm === null) {
      setErrorMessage(t("quickPrintGuideValuesError"));
      return;
    }

    const printJobPayload: PrintJobInput = {
      club: payload.selectedClubId,
      template_version: selectedVersion.id,
      ...(payload.source === "licenses"
        ? { license_ids: payload.licenseIds }
        : { member_ids: payload.memberIds }),
      ...(selectedPaperProfileValue !== TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE
        ? { paper_profile: Number(selectedPaperProfileValue) }
        : {}),
      ...(selectedSlots.length > 0 ? { selected_slots: selectedSlots } : {}),
      include_bleed_guide: includeBleedGuide,
      include_safe_area_guide: includeSafeAreaGuide,
      bleed_mm: bleedMm,
      safe_area_mm: safeAreaMm,
      metadata: {
        quick_print: true,
        source: payload.source,
        selected_count: selectedCount,
      },
    };

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const createdJob = await createPrintJob(printJobPayload);
      await executePrintJob(createdJob.id);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(QUICK_PRINT_STORAGE_KEY);
      }
      setSuccessMessage(
        t("quickPrintCreateSuccess", {
          jobNumber: createdJob.job_number,
        })
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("quickPrintCreateError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isRoleLoading) {
    return (
      <ClubAdminLayout title={t("quickPrintTitle")} subtitle={t("quickPrintSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </ClubAdminLayout>
    );
  }

  if (!canManageQuickPrint) {
    return (
      <ClubAdminLayout title={t("quickPrintTitle")} subtitle={t("quickPrintSubtitle")}>
        <EmptyState title={t("orderLicenseForbiddenTitle")} description={t("orderLicenseForbiddenSubtitle")} />
      </ClubAdminLayout>
    );
  }

  if (!hasValidSelection) {
    return (
      <ClubAdminLayout title={t("quickPrintTitle")} subtitle={t("quickPrintSubtitle")}>
        <EmptyState title={t("quickPrintNoSelectionTitle")} description={t("quickPrintNoSelectionSubtitle")} />
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push(backToSelectionRoute)}>
            {payload.source === "licenses" ? t("backToLicenses") : t("backToMembers")}
          </Button>
        </div>
      </ClubAdminLayout>
    );
  }

  return (
    <ClubAdminLayout title={t("quickPrintTitle")} subtitle={t("quickPrintSubtitle")}>
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}

      {isLoading ? (
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      ) : printableTemplates.length === 0 ? (
        <EmptyState title={t("quickPrintNoTemplateTitle")} description={t("quickPrintNoTemplateSubtitle")} />
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">{t("quickPrintSelectionSummaryTitle")}</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{t("clubLabel")}:</span>{" "}
                {clubNameById[payload.selectedClubId ?? 0] || payload.selectedClubId}
              </p>
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{t("quickPrintSourceLabel")}:</span>{" "}
                {payload.source === "licenses"
                  ? t("quickPrintSourceLicensesLabel")
                  : t("quickPrintSourceMembersLabel")}
              </p>
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{t("quickPrintSelectedCountLabel")}:</span>{" "}
                {selectedCount}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("quickPrintTemplateLabel")}</label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("quickPrintTemplatePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printableTemplates.map((template) => (
                      <SelectItem key={template.id} value={String(template.id)}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700">{t("quickPrintPaperProfileLabel")}</label>
                <Select value={selectedPaperProfileValue} onValueChange={setSelectedPaperProfileValue}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("quickPrintPaperProfilePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE}>
                      {t("quickPrintPaperProfileTemplateDefault")}
                    </SelectItem>
                    {paperProfilesForSelectedTemplate.map((profile) => (
                      <SelectItem key={profile.id} value={String(profile.id)}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">{t("quickPrintGuideOptionsTitle")}</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={includeBleedGuide}
                    onChange={(event) => setIncludeBleedGuide(event.target.checked)}
                  />
                  {t("quickPrintIncludeBleedGuideLabel")}
                </label>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("quickPrintBleedValueLabel")}
                  </label>
                  <Input value={bleedMmInput} onChange={(event) => setBleedMmInput(event.target.value)} />
                </div>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={includeSafeAreaGuide}
                    onChange={(event) => setIncludeSafeAreaGuide(event.target.checked)}
                  />
                  {t("quickPrintIncludeSafeAreaGuideLabel")}
                </label>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    {t("quickPrintSafeAreaValueLabel")}
                  </label>
                  <Input
                    value={safeAreaMmInput}
                    onChange={(event) => setSafeAreaMmInput(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">{t("quickPrintSlotPickerTitle")}</h2>
                <p className="mt-1 text-xs text-zinc-500">{t("quickPrintSlotPickerSubtitle")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAllSlots} disabled={slotCount <= 0}>
                  {t("quickPrintSelectAllSlotsAction")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelectedSlots} disabled={selectedSlots.length === 0}>
                  {t("quickPrintClearSlotsAction")}
                </Button>
              </div>
            </div>

            {slotCount <= 0 ? (
              <p className="mt-3 text-sm text-zinc-500">{t("quickPrintNoSlotProfileHint")}</p>
            ) : (
              <div
                className="mt-3 grid gap-2"
                style={{ gridTemplateColumns: `repeat(${slotColumns}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: slotCount }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggleSlotSelection(index)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selectedSlots.includes(index)
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {t("quickPrintSlotLabel", { index: index + 1 })}
                  </button>
                ))}
              </div>
            )}

            {selectedSlots.length > 0 ? (
              <p className="mt-3 text-xs text-zinc-500">
                {t("quickPrintSelectedSlotsCountLabel", { count: selectedSlots.length })}
              </p>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">{t("quickPrintAutomaticSlotModeHint")}</p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button disabled={isSubmitting} onClick={() => void handleCreateAndExecute()}>
              {isSubmitting ? t("quickPrintCreatingAction") : t("quickPrintCreateAction")}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/${locale}/dashboard/club/print-jobs`)}
            >
              {t("quickPrintOpenHistoryAction")}
            </Button>
            <Button variant="outline" onClick={() => router.push(backToSelectionRoute)}>
              {payload.source === "licenses" ? t("backToLicenses") : t("backToMembers")}
            </Button>
          </div>
        </div>
      )}
    </ClubAdminLayout>
  );
}

