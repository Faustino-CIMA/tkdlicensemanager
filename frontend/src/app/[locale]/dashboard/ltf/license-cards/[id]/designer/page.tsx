"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { EmptyState } from "@/components/club-admin/empty-state";
import { LtfAdminLayout } from "@/components/ltf-admin/ltf-admin-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/api";
import { getDashboardRouteForRole } from "@/lib/dashboard-routing";
import {
  CardDesignElement,
  CardDesignPayload,
  CardElementType,
  CardFormat,
  CardTemplate,
  CardTemplateVersion,
  MergeField,
  PaperProfile,
  createCardTemplateVersion,
  getCardFormats,
  getCardTemplate,
  getCardTemplateVersions,
  getMergeFields,
  getPaperProfiles,
  publishCardTemplateVersion,
  updateCardTemplateVersion,
} from "@/lib/license-card-api";

type AuthMeResponse = {
  role: string;
};

type EditableDesignElement = Omit<
  CardDesignElement,
  "x_mm" | "y_mm" | "width_mm" | "height_mm"
> & {
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
};

type EditableDesignPayload = Omit<CardDesignPayload, "elements"> & {
  elements: EditableDesignElement[];
};

type DragState = {
  elementId: string;
  offsetX: number;
  offsetY: number;
} | null;

const ALLOWED_ELEMENT_TYPES: CardElementType[] = [
  "text",
  "image",
  "shape",
  "qr",
  "barcode",
];
const BLEED_GUIDE_MM = 2;
const SAFE_AREA_MM = 3;
const MERGE_FIELD_TOKEN_REGEX = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function toFiniteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundMm(value: number) {
  return Number(value.toFixed(2));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generateElementId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `element-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function clampElementToCanvas(
  element: EditableDesignElement,
  canvasWidthMm: number,
  canvasHeightMm: number
): EditableDesignElement {
  const width = clamp(roundMm(element.width_mm), 0.5, canvasWidthMm);
  const height = clamp(roundMm(element.height_mm), 0.5, canvasHeightMm);
  const x = clamp(roundMm(element.x_mm), 0, Math.max(0, canvasWidthMm - width));
  const y = clamp(roundMm(element.y_mm), 0, Math.max(0, canvasHeightMm - height));
  const adjustedWidth = clamp(roundMm(width), 0.5, Math.max(0.5, canvasWidthMm - x));
  const adjustedHeight = clamp(roundMm(height), 0.5, Math.max(0.5, canvasHeightMm - y));
  return {
    ...element,
    x_mm: x,
    y_mm: y,
    width_mm: adjustedWidth,
    height_mm: adjustedHeight,
  };
}

function normalizeDesignPayload(payload: CardDesignPayload | null | undefined): EditableDesignPayload {
  const metadata = isPlainObject(payload?.metadata) ? payload?.metadata : { unit: "mm" };
  const background = isPlainObject(payload?.background) ? payload?.background : undefined;
  const elements: EditableDesignElement[] = Array.isArray(payload?.elements)
    ? payload.elements
        .map((element, index) => {
          if (!isPlainObject(element)) {
            return null;
          }
          const rawType = String(element.type || "").toLowerCase();
          if (!ALLOWED_ELEMENT_TYPES.includes(rawType as CardElementType)) {
            return null;
          }
          const normalized: EditableDesignElement = {
            id: String(element.id || `legacy-${index}-${generateElementId()}`),
            type: rawType as CardElementType,
            x_mm: toFiniteNumber(element.x_mm, 0),
            y_mm: toFiniteNumber(element.y_mm, 0),
            width_mm: Math.max(0.5, toFiniteNumber(element.width_mm, 20)),
            height_mm: Math.max(0.5, toFiniteNumber(element.height_mm, 8)),
            text: typeof element.text === "string" ? element.text : undefined,
            merge_field: typeof element.merge_field === "string" ? element.merge_field : undefined,
            source: typeof element.source === "string" ? element.source : undefined,
            rotation_deg: element.rotation_deg,
            opacity: element.opacity,
            z_index: element.z_index,
            style: isPlainObject(element.style) ? element.style : undefined,
            metadata: isPlainObject(element.metadata) ? element.metadata : undefined,
          };
          return normalized;
        })
        .filter((element): element is EditableDesignElement => Boolean(element))
    : [];
  return {
    elements,
    metadata,
    ...(background ? { background } : {}),
  };
}

function sanitizePayloadForSave(payload: EditableDesignPayload): CardDesignPayload {
  return {
    elements: payload.elements.map((element) => {
      const sanitized: CardDesignElement = {
        id: element.id,
        type: element.type,
        x_mm: roundMm(element.x_mm),
        y_mm: roundMm(element.y_mm),
        width_mm: roundMm(element.width_mm),
        height_mm: roundMm(element.height_mm),
      };
      if (typeof element.text === "string" && element.text.trim()) {
        sanitized.text = element.text;
      }
      if (typeof element.merge_field === "string" && element.merge_field.trim()) {
        sanitized.merge_field = element.merge_field;
      }
      if (typeof element.source === "string" && element.source.trim()) {
        sanitized.source = element.source;
      }
      if (typeof element.rotation_deg !== "undefined") {
        sanitized.rotation_deg = element.rotation_deg;
      }
      if (typeof element.opacity !== "undefined") {
        sanitized.opacity = element.opacity;
      }
      if (typeof element.z_index !== "undefined") {
        sanitized.z_index = element.z_index;
      }
      if (isPlainObject(element.style)) {
        sanitized.style = element.style;
      }
      if (isPlainObject(element.metadata)) {
        sanitized.metadata = element.metadata;
      }
      return sanitized;
    }),
    metadata: isPlainObject(payload.metadata) ? payload.metadata : { unit: "mm" },
    ...(isPlainObject(payload.background) ? { background: payload.background } : {}),
  };
}

function collectUnknownMergeFields(
  payload: EditableDesignPayload,
  allowedMergeFieldKeys: Set<string>
) {
  const unknown = new Set<string>();
  for (const element of payload.elements) {
    if (element.merge_field && !allowedMergeFieldKeys.has(element.merge_field)) {
      unknown.add(element.merge_field);
    }
    if (typeof element.text === "string" && element.text) {
      const matches = element.text.matchAll(MERGE_FIELD_TOKEN_REGEX);
      for (const match of matches) {
        const key = match[1];
        if (key && !allowedMergeFieldKeys.has(key)) {
          unknown.add(key);
        }
      }
    }
  }
  return Array.from(unknown.values()).sort();
}

function versionSortDesc(a: CardTemplateVersion, b: CardTemplateVersion) {
  return b.version_number - a.version_number;
}

function getVersionStatusTone(version: CardTemplateVersion | null) {
  if (!version) {
    return "neutral" as const;
  }
  if (version.status === "draft") {
    return "warning" as const;
  }
  return "success" as const;
}

export default function LtfAdminLicenseCardDesignerPage() {
  const t = useTranslations("LtfAdmin");
  const locale = useLocale();
  const params = useParams();
  const rawTemplateId = params?.id;
  const templateId = useMemo(() => {
    if (Array.isArray(rawTemplateId)) {
      return Number(rawTemplateId[0]);
    }
    return Number(rawTemplateId);
  }, [rawTemplateId]);

  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [versions, setVersions] = useState<CardTemplateVersion[]>([]);
  const [cardFormats, setCardFormats] = useState<CardFormat[]>([]);
  const [paperProfiles, setPaperProfiles] = useState<PaperProfile[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeField[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [designPayload, setDesignPayload] = useState<EditableDesignPayload>({
    elements: [],
    metadata: { unit: "mm" },
  });
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [showBleedGuide, setShowBleedGuide] = useState(true);
  const [showSafeAreaGuide, setShowSafeAreaGuide] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isPublishingDraft, setIsPublishingDraft] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const canManageDesigner = currentRole === "ltf_admin";
  const fallbackRoute = getDashboardRouteForRole(currentRole ?? "", locale) ?? `/${locale}/dashboard`;

  const cardFormatById = useMemo(() => {
    const map = new Map<number, CardFormat>();
    for (const cardFormat of cardFormats) {
      map.set(cardFormat.id, cardFormat);
    }
    return map;
  }, [cardFormats]);

  const paperProfileById = useMemo(() => {
    const map = new Map<number, PaperProfile>();
    for (const paperProfile of paperProfiles) {
      map.set(paperProfile.id, paperProfile);
    }
    return map;
  }, [paperProfiles]);

  const sortedVersions = useMemo(() => {
    return [...versions].sort(versionSortDesc);
  }, [versions]);

  const selectedVersion = useMemo(() => {
    if (!selectedVersionId) {
      return null;
    }
    return sortedVersions.find((version) => version.id === selectedVersionId) ?? null;
  }, [selectedVersionId, sortedVersions]);

  const selectedCardFormat = useMemo(() => {
    if (!selectedVersion) {
      return null;
    }
    return cardFormatById.get(selectedVersion.card_format) ?? null;
  }, [cardFormatById, selectedVersion]);

  const selectedPaperProfile = useMemo(() => {
    if (!selectedVersion?.paper_profile) {
      return null;
    }
    return paperProfileById.get(selectedVersion.paper_profile) ?? null;
  }, [paperProfileById, selectedVersion]);

  const canvasWidthMm = toFiniteNumber(selectedCardFormat?.width_mm, 85.6);
  const canvasHeightMm = toFiniteNumber(selectedCardFormat?.height_mm, 53.98);
  const canvasScale = useMemo(() => {
    const widthScale = 760 / Math.max(canvasWidthMm, 1);
    const heightScale = 520 / Math.max(canvasHeightMm, 1);
    return clamp(Math.min(widthScale, heightScale), 2.2, 8);
  }, [canvasHeightMm, canvasWidthMm]);
  const canvasWidthPx = canvasWidthMm * canvasScale;
  const canvasHeightPx = canvasHeightMm * canvasScale;
  const bleedPx = BLEED_GUIDE_MM * canvasScale;
  const safeAreaPx = SAFE_AREA_MM * canvasScale;

  const selectedElement = useMemo(() => {
    if (!selectedElementId) {
      return null;
    }
    return designPayload.elements.find((element) => element.id === selectedElementId) ?? null;
  }, [designPayload.elements, selectedElementId]);

  const mergeFieldKeySet = useMemo(() => {
    return new Set(mergeFields.map((field) => field.key));
  }, [mergeFields]);

  const isEditableDraft = canManageDesigner && selectedVersion?.status === "draft";

  const loadDesignerData = useCallback(
    async (preferredVersionId?: number) => {
      if (!templateId || Number.isNaN(templateId)) {
        setErrorMessage(t("licenseCardDesignerInvalidTemplateId"));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);
      try {
        const me = await apiRequest<AuthMeResponse>("/api/auth/me/");
        setCurrentRole(me.role);
        if (me.role !== "ltf_admin") {
          setIsLoading(false);
          return;
        }

        const [
          templateResponse,
          versionResponse,
          cardFormatResponse,
          paperProfileResponse,
          mergeFieldResponse,
        ] = await Promise.all([
          getCardTemplate(templateId),
          getCardTemplateVersions({ templateId }),
          getCardFormats(),
          getPaperProfiles(),
          getMergeFields(),
        ]);

        const versionsSorted = [...versionResponse].sort(versionSortDesc);
        setTemplate(templateResponse);
        setVersions(versionsSorted);
        setCardFormats(cardFormatResponse);
        setPaperProfiles(paperProfileResponse);
        setMergeFields(mergeFieldResponse);
        setSelectedVersionId((previousVersionId) => {
          if (
            preferredVersionId &&
            versionsSorted.some((version) => version.id === preferredVersionId)
          ) {
            return preferredVersionId;
          }
          if (
            previousVersionId &&
            versionsSorted.some((version) => version.id === previousVersionId)
          ) {
            return previousVersionId;
          }
          const latestDraft = versionsSorted.find((version) => version.status === "draft");
          if (latestDraft) {
            return latestDraft.id;
          }
          return versionsSorted[0]?.id ?? null;
        });
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : t("licenseCardDesignerLoadError")
        );
      } finally {
        setIsLoading(false);
      }
    },
    [t, templateId]
  );

  useEffect(() => {
    void loadDesignerData();
  }, [loadDesignerData]);

  useEffect(() => {
    if (!selectedVersion) {
      setDesignPayload({ elements: [], metadata: { unit: "mm" } });
      setSelectedElementId(null);
      return;
    }
    setDesignPayload(normalizeDesignPayload(selectedVersion.design_payload));
    setSelectedElementId(null);
  }, [selectedVersion]);

  useEffect(() => {
    if (!dragState || !isEditableDraft) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) {
        return;
      }
      const xPx = event.clientX - canvasRect.left - dragState.offsetX;
      const yPx = event.clientY - canvasRect.top - dragState.offsetY;

      setDesignPayload((previousPayload) => {
        const nextElements = previousPayload.elements.map((element) => {
          if (element.id !== dragState.elementId) {
            return element;
          }
          return clampElementToCanvas(
            {
              ...element,
              x_mm: xPx / canvasScale,
              y_mm: yPx / canvasScale,
            },
            canvasWidthMm,
            canvasHeightMm
          );
        });
        return {
          ...previousPayload,
          elements: nextElements,
        };
      });
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [canvasHeightMm, canvasScale, canvasWidthMm, dragState, isEditableDraft]);

  const updateSelectedElement = useCallback(
    (updater: (element: EditableDesignElement) => EditableDesignElement) => {
      if (!selectedElementId) {
        return;
      }
      setDesignPayload((previousPayload) => {
        const nextElements = previousPayload.elements.map((element) => {
          if (element.id !== selectedElementId) {
            return element;
          }
          const updatedElement = updater(element);
          return clampElementToCanvas(updatedElement, canvasWidthMm, canvasHeightMm);
        });
        return {
          ...previousPayload,
          elements: nextElements,
        };
      });
    },
    [canvasHeightMm, canvasWidthMm, selectedElementId]
  );

  const removeSelectedElement = () => {
    if (!selectedElementId || !isEditableDraft) {
      return;
    }
    setDesignPayload((previousPayload) => ({
      ...previousPayload,
      elements: previousPayload.elements.filter((element) => element.id !== selectedElementId),
    }));
    setSelectedElementId(null);
  };

  const createElement = useCallback(
    (type: CardElementType, xMm: number, yMm: number): EditableDesignElement => {
      const common = {
        id: generateElementId(),
        type,
      };
      if (type === "text") {
        return clampElementToCanvas(
          {
            ...common,
            x_mm: xMm,
            y_mm: yMm,
            width_mm: 32,
            height_mm: 10,
            text: "{{member.full_name}}",
          },
          canvasWidthMm,
          canvasHeightMm
        );
      }
      if (type === "image") {
        return clampElementToCanvas(
          {
            ...common,
            x_mm: xMm,
            y_mm: yMm,
            width_mm: 18,
            height_mm: 18,
            source: "",
          },
          canvasWidthMm,
          canvasHeightMm
        );
      }
      if (type === "shape") {
        return clampElementToCanvas(
          {
            ...common,
            x_mm: xMm,
            y_mm: yMm,
            width_mm: 20,
            height_mm: 12,
          },
          canvasWidthMm,
          canvasHeightMm
        );
      }
      if (type === "qr") {
        const qrMergeField = mergeFieldKeySet.has("qr.validation_url")
          ? "qr.validation_url"
          : "";
        return clampElementToCanvas(
          {
            ...common,
            x_mm: xMm,
            y_mm: yMm,
            width_mm: 16,
            height_mm: 16,
            merge_field: qrMergeField || undefined,
          },
          canvasWidthMm,
          canvasHeightMm
        );
      }
      const barcodeMergeField = mergeFieldKeySet.has("member.ltf_licenseid")
        ? "member.ltf_licenseid"
        : "";
      return clampElementToCanvas(
        {
          ...common,
          x_mm: xMm,
          y_mm: yMm,
          width_mm: 32,
          height_mm: 10,
          merge_field: barcodeMergeField || undefined,
        },
        canvasWidthMm,
        canvasHeightMm
      );
    },
    [canvasHeightMm, canvasWidthMm, mergeFieldKeySet]
  );

  const applyToolDrop = (elementType: CardElementType, xMm: number, yMm: number) => {
    const newElement = createElement(elementType, xMm, yMm);
    setDesignPayload((previousPayload) => ({
      ...previousPayload,
      elements: [...previousPayload.elements, newElement],
    }));
    setSelectedElementId(newElement.id);
  };

  const onCanvasDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (!isEditableDraft) {
      return;
    }
    event.preventDefault();
    const rawType = event.dataTransfer.getData("application/x-license-card-tool");
    if (!ALLOWED_ELEMENT_TYPES.includes(rawType as CardElementType)) {
      return;
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }
    const xMm = (event.clientX - canvasRect.left) / canvasScale;
    const yMm = (event.clientY - canvasRect.top) / canvasScale;
    applyToolDrop(rawType as CardElementType, xMm, yMm);
  };

  const onCanvasDragOver: React.DragEventHandler<HTMLDivElement> = (event) => {
    if (!isEditableDraft) {
      return;
    }
    event.preventDefault();
  };

  const handleElementMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    element: EditableDesignElement
  ) => {
    event.stopPropagation();
    setSelectedElementId(element.id);
    if (!isEditableDraft) {
      return;
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }
    const elementX = element.x_mm * canvasScale;
    const elementY = element.y_mm * canvasScale;
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;
    setDragState({
      elementId: element.id,
      offsetX: pointerX - elementX,
      offsetY: pointerY - elementY,
    });
  };

  const handleSaveDraft = async () => {
    if (!selectedVersion || selectedVersion.status !== "draft") {
      setErrorMessage(t("licenseCardDesignerDraftOnlyError"));
      return;
    }

    const unknownMergeFields = collectUnknownMergeFields(designPayload, mergeFieldKeySet);
    if (unknownMergeFields.length > 0) {
      setErrorMessage(
        t("licenseCardDesignerUnknownMergeFieldsError", {
          fields: unknownMergeFields.join(", "),
        })
      );
      return;
    }

    setIsSavingDraft(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updatedVersion = await updateCardTemplateVersion(selectedVersion.id, {
        design_payload: sanitizePayloadForSave(designPayload),
      });
      setVersions((previousVersions) =>
        previousVersions.map((version) =>
          version.id === updatedVersion.id ? updatedVersion : version
        )
      );
      setSuccessMessage(t("licenseCardDesignerDraftSaved"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardDesignerDraftSaveError")
      );
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!template) {
      return;
    }

    const baseVersion = selectedVersion ?? sortedVersions[0] ?? null;
    const cardFormatId = baseVersion?.card_format ?? cardFormats[0]?.id;
    if (!cardFormatId) {
      setErrorMessage(t("licenseCardDesignerNoCardFormatsError"));
      return;
    }

    let paperProfileId: number | null = baseVersion?.paper_profile ?? null;
    const basePaperProfile = paperProfileId ? paperProfileById.get(paperProfileId) : null;
    if (basePaperProfile && basePaperProfile.card_format !== cardFormatId) {
      paperProfileId = null;
    }
    if (!paperProfileId) {
      const fallbackProfile = paperProfiles.find(
        (paperProfile) => paperProfile.card_format === cardFormatId
      );
      paperProfileId = fallbackProfile?.id ?? null;
    }

    setIsCreatingDraft(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const createdVersion = await createCardTemplateVersion({
        template: template.id,
        label: baseVersion
          ? t("licenseCardDesignerDraftFromVersionLabel", {
              version: baseVersion.version_number,
            })
          : t("licenseCardDesignerDraftInitialLabel"),
        card_format: cardFormatId,
        paper_profile: paperProfileId ?? undefined,
        design_payload: sanitizePayloadForSave(
          baseVersion
            ? normalizeDesignPayload(baseVersion.design_payload)
            : { elements: [], metadata: { unit: "mm" } }
        ),
      });
      await loadDesignerData(createdVersion.id);
      setSuccessMessage(t("licenseCardDesignerDraftCreated"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardDesignerDraftCreateError")
      );
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handlePublishDraft = async () => {
    if (!selectedVersion || selectedVersion.status !== "draft") {
      setErrorMessage(t("licenseCardDesignerDraftOnlyError"));
      return;
    }

    setIsPublishingDraft(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await publishCardTemplateVersion(selectedVersion.id);
      await loadDesignerData(selectedVersion.id);
      setSuccessMessage(t("licenseCardDesignerDraftPublished"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardDesignerDraftPublishError")
      );
    } finally {
      setIsPublishingDraft(false);
    }
  };

  const toolLabelByType = {
    text: t("licenseCardDesignerToolText"),
    image: t("licenseCardDesignerToolImage"),
    shape: t("licenseCardDesignerToolShape"),
    qr: t("licenseCardDesignerToolQr"),
    barcode: t("licenseCardDesignerToolBarcode"),
  } satisfies Record<CardElementType, string>;

  const pageTitle = template
    ? t("licenseCardDesignerTitle", { name: template.name })
    : t("licenseCardDesignerTitleFallback");

  if (isLoading) {
    return (
      <LtfAdminLayout title={pageTitle} subtitle={t("licenseCardDesignerSubtitle")}>
        <EmptyState title={t("loadingTitle")} description={t("loadingSubtitle")} />
      </LtfAdminLayout>
    );
  }

  if (!canManageDesigner) {
    return (
      <LtfAdminLayout title={pageTitle} subtitle={t("licenseCardDesignerSubtitle")}>
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

  if (errorMessage && !template) {
    return (
      <LtfAdminLayout title={pageTitle} subtitle={t("licenseCardDesignerSubtitle")}>
        <EmptyState title={t("licenseCardDesignerLoadError")} description={errorMessage} />
      </LtfAdminLayout>
    );
  }

  return (
    <LtfAdminLayout title={pageTitle} subtitle={t("licenseCardDesignerSubtitle")}>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/${locale}/dashboard/ltf/license-cards`}>
            {t("licenseCardDesignerBackToTemplatesAction")}
          </Link>
        </Button>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-700">{successMessage}</p> : null}

      <section className="mb-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{t("licenseCardsTemplateNameLabel")}</p>
            <p className="text-sm font-medium text-zinc-900">{template?.name || "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{t("licenseCardDesignerVersionLabel")}</p>
            <div className="flex items-center gap-2">
              <StatusBadge
                label={
                  selectedVersion
                    ? t("licenseCardDesignerVersionStatusSummary", {
                        version: selectedVersion.version_number,
                        status:
                          selectedVersion.status === "draft"
                            ? t("licenseCardDesignerVersionStatusDraft")
                            : t("licenseCardDesignerVersionStatusPublished"),
                      })
                    : t("licenseCardDesignerNoVersions")
                }
                tone={getVersionStatusTone(selectedVersion)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{t("licenseCardDesignerCardFormatLabel")}</p>
            <p className="text-sm font-medium text-zinc-900">{selectedCardFormat?.name || "-"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-zinc-500">{t("licenseCardDesignerPaperProfileLabel")}</p>
            <p className="text-sm font-medium text-zinc-900">{selectedPaperProfile?.name || "-"}</p>
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs space-y-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("licenseCardDesignerVersionLabel")}
            </label>
            <Select
              value={selectedVersionId ? String(selectedVersionId) : "none"}
              onValueChange={(value) => {
                setSuccessMessage(null);
                setErrorMessage(null);
                setSelectedVersionId(value === "none" ? null : Number(value));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("licenseCardDesignerSelectVersionPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {sortedVersions.length === 0 ? (
                  <SelectItem value="none">{t("licenseCardDesignerNoVersions")}</SelectItem>
                ) : (
                  sortedVersions.map((version) => (
                    <SelectItem key={version.id} value={String(version.id)}>
                      {t("licenseCardDesignerVersionOptionLabel", {
                        version: version.version_number,
                        status:
                          version.status === "draft"
                            ? t("licenseCardDesignerVersionStatusDraft")
                            : t("licenseCardDesignerVersionStatusPublished"),
                      })}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            disabled={isCreatingDraft || isSavingDraft || isPublishingDraft}
            onClick={() => void handleCreateDraft()}
          >
            {isCreatingDraft
              ? t("licenseCardDesignerCreatingDraftAction")
              : t("licenseCardDesignerCreateDraftAction")}
          </Button>

          <Button
            disabled={!isEditableDraft || isSavingDraft || isPublishingDraft}
            onClick={() => void handleSaveDraft()}
          >
            {isSavingDraft
              ? t("licenseCardDesignerSavingDraftAction")
              : t("licenseCardDesignerSaveDraftAction")}
          </Button>

          <Button
            variant="secondary"
            disabled={!isEditableDraft || isSavingDraft || isPublishingDraft}
            onClick={() => void handlePublishDraft()}
          >
            {isPublishingDraft
              ? t("licenseCardDesignerPublishingDraftAction")
              : t("licenseCardDesignerPublishDraftAction")}
          </Button>
        </div>
      </section>

      {selectedVersion?.status === "published" ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {t("licenseCardDesignerPublishedReadOnlyHint")}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <section className="space-y-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("licenseCardDesignerElementToolsTitle")}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {t("licenseCardDesignerDragHint")}
            </p>
          </div>
          <div className="grid gap-2">
            {ALLOWED_ELEMENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                draggable={isEditableDraft}
                disabled={!isEditableDraft}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-license-card-tool", type);
                }}
              >
                {toolLabelByType[type]}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">
              {t("licenseCardDesignerMergeFieldsTitle")}
            </h3>
            {mergeFields.length === 0 ? (
              <p className="text-xs text-zinc-500">{t("licenseCardDesignerMergeFieldsEmpty")}</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {mergeFields.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-left transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isEditableDraft || !selectedElement}
                    onClick={() => {
                      if (!selectedElement || !isEditableDraft) {
                        return;
                      }
                      updateSelectedElement((element) => {
                        if (element.type === "shape") {
                          return element;
                        }
                        if (element.type === "text") {
                          return {
                            ...element,
                            merge_field: field.key,
                            text: `{{${field.key}}}`,
                          };
                        }
                        return {
                          ...element,
                          merge_field: field.key,
                        };
                      });
                    }}
                  >
                    <p className="text-xs font-medium text-zinc-800">{field.label}</p>
                    <p className="text-[11px] text-zinc-500">{field.key}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              {t("licenseCardDesignerCanvasTitle")}
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                <Checkbox
                  checked={showBleedGuide}
                  onCheckedChange={(checked) => setShowBleedGuide(Boolean(checked))}
                />
                {t("licenseCardDesignerBleedGuideToggle")}
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                <Checkbox
                  checked={showSafeAreaGuide}
                  onCheckedChange={(checked) => setShowSafeAreaGuide(Boolean(checked))}
                />
                {t("licenseCardDesignerSafeAreaGuideToggle")}
              </label>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            {t("licenseCardDesignerCanvasSizeLabel", {
              width: canvasWidthMm.toFixed(2),
              height: canvasHeightMm.toFixed(2),
              scale: canvasScale.toFixed(2),
            })}
          </p>

          {!selectedVersion ? (
            <EmptyState
              title={t("licenseCardDesignerNoVersionsTitle")}
              description={t("licenseCardDesignerNoVersionsSubtitle")}
            />
          ) : (
            <div className="overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 p-4">
              <div
                ref={canvasRef}
                className="relative mx-auto bg-white shadow-md"
                style={{ width: canvasWidthPx, height: canvasHeightPx }}
                onDragOver={onCanvasDragOver}
                onDrop={onCanvasDrop}
                onClick={() => setSelectedElementId(null)}
              >
                {showBleedGuide ? (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      boxShadow: `inset 0 0 0 ${bleedPx}px rgba(244, 63, 94, 0.18)`,
                    }}
                  />
                ) : null}
                {showSafeAreaGuide ? (
                  <div
                    className="pointer-events-none absolute border border-dashed border-emerald-500/80"
                    style={{
                      left: safeAreaPx,
                      top: safeAreaPx,
                      width: Math.max(canvasWidthPx - safeAreaPx * 2, 0),
                      height: Math.max(canvasHeightPx - safeAreaPx * 2, 0),
                    }}
                  />
                ) : null}

                {designPayload.elements.map((element) => {
                  const isSelected = selectedElementId === element.id;
                  let elementContent = "";
                  if (element.type === "text") {
                    elementContent = element.text || "{{member.full_name}}";
                  } else if (element.type === "shape") {
                    elementContent = t("licenseCardDesignerToolShape");
                  } else if (element.type === "image") {
                    elementContent = t("licenseCardDesignerToolImage");
                  } else if (element.type === "qr") {
                    elementContent = `QR: ${element.merge_field || "qr.validation_url"}`;
                  } else {
                    elementContent = `BAR: ${element.merge_field || "member.ltf_licenseid"}`;
                  }

                  return (
                    <div
                      key={element.id}
                      className={`absolute flex select-none items-center justify-center rounded border px-1 text-center text-[10px] ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-zinc-300 bg-white/85 text-zinc-700"
                      }`}
                      style={{
                        left: element.x_mm * canvasScale,
                        top: element.y_mm * canvasScale,
                        width: element.width_mm * canvasScale,
                        height: element.height_mm * canvasScale,
                        backgroundColor:
                          element.type === "shape"
                            ? "rgba(59, 130, 246, 0.15)"
                            : undefined,
                      }}
                      onMouseDown={(event) => handleElementMouseDown(event, element)}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedElementId(element.id);
                      }}
                    >
                      <span className="pointer-events-none line-clamp-2">{elementContent}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">
            {t("licenseCardDesignerInspectorTitle")}
          </h2>
          {!selectedElement ? (
            <p className="text-sm text-zinc-500">
              {t("licenseCardDesignerInspectorEmpty")}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase text-zinc-500">
                  {t("licenseCardDesignerElementTypeLabel")}
                </label>
                <p className="text-sm font-medium text-zinc-900">
                  {toolLabelByType[selectedElement.type]}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerXLabel")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedElement.x_mm}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      updateSelectedElement((element) => ({
                        ...element,
                        x_mm: nextValue,
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerYLabel")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedElement.y_mm}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      updateSelectedElement((element) => ({
                        ...element,
                        y_mm: nextValue,
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerWidthLabel")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedElement.width_mm}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      updateSelectedElement((element) => ({
                        ...element,
                        width_mm: nextValue,
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerHeightLabel")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedElement.height_mm}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      updateSelectedElement((element) => ({
                        ...element,
                        height_mm: nextValue,
                      }));
                    }}
                  />
                </div>
              </div>

              {(selectedElement.type === "text" ||
                selectedElement.type === "qr" ||
                selectedElement.type === "barcode") ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerMergeFieldLabel")}
                  </label>
                  <Select
                    disabled={!isEditableDraft}
                    value={selectedElement.merge_field || "none"}
                    onValueChange={(value) => {
                      updateSelectedElement((element) => {
                        const mergeFieldValue = value === "none" ? undefined : value;
                        if (element.type === "text") {
                          return {
                            ...element,
                            merge_field: mergeFieldValue,
                            text: mergeFieldValue ? `{{${mergeFieldValue}}}` : element.text,
                          };
                        }
                        return {
                          ...element,
                          merge_field: mergeFieldValue,
                        };
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("licenseCardDesignerMergeFieldPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("licenseCardDesignerNoMergeFieldOption")}</SelectItem>
                      {mergeFields.map((field) => (
                        <SelectItem key={field.key} value={field.key}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {selectedElement.type === "text" ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerTextLabel")}
                  </label>
                  <textarea
                    className="min-h-[96px] w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                    value={selectedElement.text || ""}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      updateSelectedElement((element) => ({
                        ...element,
                        text: event.target.value,
                      }));
                    }}
                  />
                </div>
              ) : null}

              {selectedElement.type === "image" ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerImageSourceLabel")}
                  </label>
                  <Input
                    value={selectedElement.source || ""}
                    disabled={!isEditableDraft}
                    placeholder={t("licenseCardDesignerImageSourcePlaceholder")}
                    onChange={(event) => {
                      updateSelectedElement((element) => ({
                        ...element,
                        source: event.target.value,
                      }));
                    }}
                  />
                </div>
              ) : null}

              <Button
                variant="destructive"
                size="sm"
                disabled={!isEditableDraft}
                onClick={removeSelectedElement}
              >
                {t("licenseCardDesignerRemoveElementAction")}
              </Button>
            </div>
          )}
        </section>
      </div>
    </LtfAdminLayout>
  );
}
