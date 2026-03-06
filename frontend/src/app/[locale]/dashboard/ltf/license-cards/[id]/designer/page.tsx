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
import { Modal } from "@/components/ui/modal";
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
  buildShapeGradientStylePatch,
  normalizeShapeGradientStyleForSave,
  resolveShapeGradientState,
} from "@/lib/license-card-gradient";
import {
  CardDesignElement,
  CardDesignPayload,
  CardFontAsset,
  CardFontAssetUploadInput,
  CardImageAsset,
  CardImageAssetUploadInput,
  CardDesignerLookupItem,
  CardElementType,
  CardFormat,
  CardPreviewDataResponse,
  CardPreviewHtmlResponse,
  CardPreviewRequestInput,
  CardSide,
  CardSheetPreviewRequestInput,
  CardTemplate,
  CardTemplateVersion,
  MergeField,
  PaperProfile,
  createCardFontAsset,
  createCardImageAsset,
  createCardTemplateVersion,
  getCardFormats,
  getCardFontAssets,
  getCardImageAssets,
  getCardDesignerClubLookups,
  getCardDesignerLicenseLookups,
  getCardDesignerMemberLookups,
  getCardTemplateVersionCardPreviewHtml,
  getCardTemplateVersionCardPreviewPdf,
  getCardTemplateVersionPreviewData,
  getCardTemplateVersionSheetPreviewPdf,
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

type EditableDesignPayloadBySide = Record<CardSide, EditableDesignPayload>;

type CardSideSummaryInfo = {
  element_count: number;
  has_background: boolean;
  has_content: boolean;
  is_active: boolean;
};

type ElementBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

type SnapGuideLine = {
  orientation: "vertical" | "horizontal";
  value_mm: number;
  source: "grid" | "element";
};

type DragState = {
  elementId: string;
  targetIds: string[];
  pointerOffsetX: number;
  pointerOffsetY: number;
  startPositions: Record<string, { x_mm: number; y_mm: number }>;
  startSelectionBounds: ElementBounds;
  snapTargets: {
    vertical: number[];
    horizontal: number[];
  };
} | null;

type ResizeState = {
  elementId: string;
  startX_mm: number;
  startY_mm: number;
  startWidth_mm: number;
  startHeight_mm: number;
  startPointerX: number;
  startPointerY: number;
  snapTargets: {
    vertical: number[];
    horizontal: number[];
  };
} | null;

type SheetGeometryProfile = {
  source: "preview-data" | "paper-profile";
  sheet_width_mm: number;
  sheet_height_mm: number;
  card_width_mm: number;
  card_height_mm: number;
  margin_top_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  horizontal_gap_mm: number;
  vertical_gap_mm: number;
  card_corner_radius_mm: number;
  rows: number;
  columns: number;
  slot_count: number;
};

type SheetGeometrySlot = {
  slot_index: number;
  row: number;
  column: number;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  x_end_mm: number;
  y_end_mm: number;
  card_corner_radius_mm: number;
  selected: boolean;
};

type SheetGeometryParityIssue = {
  slot_index: number;
  field: string;
  expected: number;
  actual: number;
};

const ALLOWED_ELEMENT_TYPES: CardElementType[] = [
  "text",
  "image",
  "shape",
  "qr",
  "barcode",
];
const DEFAULT_BLEED_MM = "2.00";
const DEFAULT_SAFE_AREA_MM = "3.00";
const TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE = "template-default";
const MERGE_FIELD_TOKEN_REGEX = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const PREVIEW_LOOKUP_LIMIT = 20;
const HISTORY_STACK_LIMIT = 250;
const DEFAULT_GRID_SIZE_MM = "1.00";
const DEFAULT_SNAP_THRESHOLD_MM = "1.20";
const RULER_SIZE_PX = 24;
const CONTRACT_CARD_WIDTH_MM = 85.0;
const CONTRACT_CARD_HEIGHT_MM = 55.0;
const LP798_SHEET_WIDTH_MM = 210.0;
const LP798_SHEET_HEIGHT_MM = 297.0;
const LP798_MARGIN_TOP_MM = 10.0;
const LP798_MARGIN_BOTTOM_MM = 12.0;
const LP798_MARGIN_LEFT_MM = 15.0;
const LP798_MARGIN_RIGHT_MM = 15.0;
const LP798_HORIZONTAL_GAP_MM = 10.0;
const LP798_VERTICAL_GAP_MM = 0.0;
const LP798_COLUMNS = 2;
const LP798_ROWS = 5;
const LP798_SLOT_COUNT = 10;
const SHEET_PREVIEW_MAX_WIDTH_PX = 620;
const SHEET_PREVIEW_MAX_HEIGHT_PX = 720;
const TEXT_ALIGN_OPTIONS = ["left", "center", "right", "justify"] as const;
const TEXT_TRANSFORM_OPTIONS = ["none", "uppercase", "lowercase", "capitalize"] as const;
const TEXT_DECORATION_OPTIONS = ["none", "underline", "line-through"] as const;
const OBJECT_FIT_OPTIONS = ["contain", "cover", "fill", "scale-down", "none"] as const;
const BORDER_STYLE_OPTIONS = ["solid", "dashed", "dotted"] as const;
const SHAPE_KIND_OPTIONS = [
  "rectangle",
  "circle",
  "ellipse",
  "line",
  "star",
  "arrow",
  "polygon",
] as const;
const QR_DATA_MODE_OPTIONS = ["single_merge", "multi_merge", "custom"] as const;
const CARD_SIDES: CardSide[] = ["front", "back"];
const DEFAULT_ACTIVE_SIDE: CardSide = "front";
const CORNER_RADIUS_STYLE_KEYS = [
  "radius_top_left_mm",
  "radius_top_right_mm",
  "radius_bottom_right_mm",
  "radius_bottom_left_mm",
] as const;
type CornerRadiusStyleKey = (typeof CORNER_RADIUS_STYLE_KEYS)[number];

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

function toMmString(value: number) {
  return roundMm(value).toFixed(2);
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

function normalizeSlotSelection(selectedSlots: number[], slotCount: number) {
  const unique = new Set<number>();
  for (const slot of selectedSlots) {
    if (Number.isInteger(slot) && slot >= 0 && slot < slotCount) {
      unique.add(slot);
    }
  }
  return Array.from(unique.values()).sort((a, b) => a - b);
}

function toFiniteInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function buildSheetGeometryProfile(
  previewPaperProfile: CardPreviewDataResponse["paper_profile"] | null | undefined,
  fallbackPaperProfile: PaperProfile | null
): SheetGeometryProfile | null {
  if (!previewPaperProfile && !fallbackPaperProfile) {
    return null;
  }

  const fallbackCardWidthMm = toFiniteNumber(
    fallbackPaperProfile?.card_width_mm,
    CONTRACT_CARD_WIDTH_MM
  );
  const fallbackCardHeightMm = toFiniteNumber(
    fallbackPaperProfile?.card_height_mm,
    CONTRACT_CARD_HEIGHT_MM
  );
  const fallbackSheetWidthMm = toFiniteNumber(
    fallbackPaperProfile?.sheet_width_mm,
    LP798_SHEET_WIDTH_MM
  );
  const fallbackSheetHeightMm = toFiniteNumber(
    fallbackPaperProfile?.sheet_height_mm,
    LP798_SHEET_HEIGHT_MM
  );
  const fallbackMarginTopMm = toFiniteNumber(
    fallbackPaperProfile?.margin_top_mm,
    LP798_MARGIN_TOP_MM
  );
  const fallbackMarginBottomMm = toFiniteNumber(
    fallbackPaperProfile?.margin_bottom_mm,
    LP798_MARGIN_BOTTOM_MM
  );
  const fallbackMarginLeftMm = toFiniteNumber(
    fallbackPaperProfile?.margin_left_mm,
    LP798_MARGIN_LEFT_MM
  );
  const fallbackMarginRightMm = toFiniteNumber(
    fallbackPaperProfile?.margin_right_mm,
    LP798_MARGIN_RIGHT_MM
  );
  const fallbackHorizontalGapMm = toFiniteNumber(
    fallbackPaperProfile?.horizontal_gap_mm,
    LP798_HORIZONTAL_GAP_MM
  );
  const fallbackVerticalGapMm = toFiniteNumber(
    fallbackPaperProfile?.vertical_gap_mm,
    LP798_VERTICAL_GAP_MM
  );
  const fallbackRows = Math.max(1, toFiniteInteger(fallbackPaperProfile?.rows, LP798_ROWS));
  const fallbackColumns = Math.max(
    1,
    toFiniteInteger(fallbackPaperProfile?.columns, LP798_COLUMNS)
  );
  const fallbackSlotCount = Math.max(
    1,
    toFiniteInteger(fallbackPaperProfile?.slot_count, LP798_SLOT_COUNT)
  );
  const fallbackCornerRadiusMm = Math.max(
    0,
    toFiniteNumber(fallbackPaperProfile?.card_corner_radius_mm, 0)
  );

  if (!previewPaperProfile) {
    return {
      source: "paper-profile",
      sheet_width_mm: roundMm(fallbackSheetWidthMm),
      sheet_height_mm: roundMm(fallbackSheetHeightMm),
      card_width_mm: roundMm(fallbackCardWidthMm),
      card_height_mm: roundMm(fallbackCardHeightMm),
      margin_top_mm: roundMm(fallbackMarginTopMm),
      margin_bottom_mm: roundMm(fallbackMarginBottomMm),
      margin_left_mm: roundMm(fallbackMarginLeftMm),
      margin_right_mm: roundMm(fallbackMarginRightMm),
      horizontal_gap_mm: roundMm(fallbackHorizontalGapMm),
      vertical_gap_mm: roundMm(fallbackVerticalGapMm),
      card_corner_radius_mm: roundMm(fallbackCornerRadiusMm),
      rows: fallbackRows,
      columns: fallbackColumns,
      slot_count: fallbackSlotCount,
    };
  }

  return {
    source: "preview-data",
    sheet_width_mm: roundMm(toFiniteNumber(previewPaperProfile.sheet_width_mm, fallbackSheetWidthMm)),
    sheet_height_mm: roundMm(
      toFiniteNumber(previewPaperProfile.sheet_height_mm, fallbackSheetHeightMm)
    ),
    card_width_mm: roundMm(toFiniteNumber(previewPaperProfile.card_width_mm, fallbackCardWidthMm)),
    card_height_mm: roundMm(
      toFiniteNumber(previewPaperProfile.card_height_mm, fallbackCardHeightMm)
    ),
    margin_top_mm: roundMm(
      toFiniteNumber(previewPaperProfile.margin_top_mm, fallbackMarginTopMm)
    ),
    margin_bottom_mm: roundMm(
      toFiniteNumber(previewPaperProfile.margin_bottom_mm, fallbackMarginBottomMm)
    ),
    margin_left_mm: roundMm(
      toFiniteNumber(previewPaperProfile.margin_left_mm, fallbackMarginLeftMm)
    ),
    margin_right_mm: roundMm(
      toFiniteNumber(previewPaperProfile.margin_right_mm, fallbackMarginRightMm)
    ),
    horizontal_gap_mm: roundMm(
      toFiniteNumber(previewPaperProfile.horizontal_gap_mm, fallbackHorizontalGapMm)
    ),
    vertical_gap_mm: roundMm(
      toFiniteNumber(previewPaperProfile.vertical_gap_mm, fallbackVerticalGapMm)
    ),
    card_corner_radius_mm: roundMm(
      Math.max(0, toFiniteNumber(previewPaperProfile.card_corner_radius_mm, fallbackCornerRadiusMm))
    ),
    rows: Math.max(1, toFiniteInteger(previewPaperProfile.rows, fallbackRows)),
    columns: Math.max(1, toFiniteInteger(previewPaperProfile.columns, fallbackColumns)),
    slot_count: Math.max(1, toFiniteInteger(previewPaperProfile.slot_count, fallbackSlotCount)),
  };
}

function buildSheetSlotsFromProfile(
  profile: SheetGeometryProfile,
  selectedSlots: number[]
): SheetGeometrySlot[] {
  const normalizedSelectedSlots = normalizeSlotSelection(selectedSlots, profile.slot_count);
  const selectedSet = new Set(normalizedSelectedSlots);
  const slots: SheetGeometrySlot[] = [];

  for (let slotIndex = 0; slotIndex < profile.slot_count; slotIndex += 1) {
    const row = Math.floor(slotIndex / profile.columns);
    const column = slotIndex % profile.columns;
    const xMm = roundMm(
      profile.margin_left_mm + column * (profile.card_width_mm + profile.horizontal_gap_mm)
    );
    const yMm = roundMm(
      profile.margin_top_mm + row * (profile.card_height_mm + profile.vertical_gap_mm)
    );
    const widthMm = roundMm(profile.card_width_mm);
    const heightMm = roundMm(profile.card_height_mm);

    slots.push({
      slot_index: slotIndex,
      row,
      column,
      x_mm: xMm,
      y_mm: yMm,
      width_mm: widthMm,
      height_mm: heightMm,
      x_end_mm: roundMm(xMm + widthMm),
      y_end_mm: roundMm(yMm + heightMm),
      card_corner_radius_mm: roundMm(profile.card_corner_radius_mm),
      selected: selectedSet.has(slotIndex),
    });
  }

  return slots;
}

function normalizePreviewSheetSlot(
  slot: CardPreviewDataResponse["slots"][number]
): SheetGeometrySlot {
  const xMm = roundMm(toFiniteNumber(slot.x_mm, 0));
  const yMm = roundMm(toFiniteNumber(slot.y_mm, 0));
  const widthMm = roundMm(Math.max(0, toFiniteNumber(slot.width_mm, CONTRACT_CARD_WIDTH_MM)));
  const heightMm = roundMm(Math.max(0, toFiniteNumber(slot.height_mm, CONTRACT_CARD_HEIGHT_MM)));
  return {
    slot_index: slot.slot_index,
    row: slot.row,
    column: slot.column,
    x_mm: xMm,
    y_mm: yMm,
    width_mm: widthMm,
    height_mm: heightMm,
    x_end_mm: roundMm(toFiniteNumber(slot.x_end_mm, xMm + widthMm)),
    y_end_mm: roundMm(toFiniteNumber(slot.y_end_mm, yMm + heightMm)),
    card_corner_radius_mm: roundMm(Math.max(0, toFiniteNumber(slot.card_corner_radius_mm, 0))),
    selected: Boolean(slot.selected),
  };
}

function compareSheetSlotGeometry(
  backendSlots: SheetGeometrySlot[],
  frontendSlots: SheetGeometrySlot[]
): SheetGeometryParityIssue[] {
  const issues: SheetGeometryParityIssue[] = [];
  const frontendSlotByIndex = new Map(frontendSlots.map((slot) => [slot.slot_index, slot]));
  const mmFields: Array<
    keyof Pick<SheetGeometrySlot, "x_mm" | "y_mm" | "width_mm" | "height_mm" | "x_end_mm" | "y_end_mm">
  > = ["x_mm", "y_mm", "width_mm", "height_mm", "x_end_mm", "y_end_mm"];

  for (const backendSlot of backendSlots) {
    const frontendSlot = frontendSlotByIndex.get(backendSlot.slot_index);
    if (!frontendSlot) {
      issues.push({
        slot_index: backendSlot.slot_index,
        field: "slot_missing",
        expected: 1,
        actual: 0,
      });
      continue;
    }

    for (const field of mmFields) {
      const expectedValue = roundMm(backendSlot[field]);
      const actualValue = roundMm(frontendSlot[field]);
      if (Math.abs(expectedValue - actualValue) > 0.01) {
        issues.push({
          slot_index: backendSlot.slot_index,
          field,
          expected: expectedValue,
          actual: actualValue,
        });
      }
    }

    if (backendSlot.row !== frontendSlot.row) {
      issues.push({
        slot_index: backendSlot.slot_index,
        field: "row",
        expected: backendSlot.row,
        actual: frontendSlot.row,
      });
    }
    if (backendSlot.column !== frontendSlot.column) {
      issues.push({
        slot_index: backendSlot.slot_index,
        field: "column",
        expected: backendSlot.column,
        actual: frontendSlot.column,
      });
    }
  }

  if (backendSlots.length !== frontendSlots.length) {
    issues.push({
      slot_index: -1,
      field: "slot_count",
      expected: backendSlots.length,
      actual: frontendSlots.length,
    });
  }

  return issues;
}

function parsePreviewSampleData(sampleDataInput: string): Record<string, unknown> {
  const normalized = sampleDataInput.trim();
  if (!normalized) {
    return {};
  }
  const parsed = JSON.parse(normalized) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("sample_data must be a JSON object.");
  }
  return parsed;
}

function openBlobInNewTab(blob: Blob) {
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 15000);
}

function buildCardSimulationSrcDoc(payload: CardPreviewHtmlResponse | null) {
  if (!payload) {
    return "";
  }
  const simulationHtml = payload.html || "";
  const simulationCss = payload.css || "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${simulationCss}</style></head><body>${simulationHtml}</body></html>`;
}

function getPreviewElementResolvedValue(
  element: CardPreviewDataResponse["elements"][number]
) {
  if (typeof element.resolved_text === "string" && element.resolved_text.trim()) {
    return element.resolved_text;
  }
  if (typeof element.resolved_value === "string" && element.resolved_value.trim()) {
    return element.resolved_value;
  }
  if (typeof element.resolved_source === "string" && element.resolved_source.trim()) {
    return element.resolved_source;
  }
  if (typeof element.merge_field === "string" && element.merge_field.trim()) {
    return `{{${element.merge_field}}}`;
  }
  return "-";
}

type DesignerLookupFieldProps = {
  label: string;
  searchPlaceholder: string;
  selectedPlaceholder: string;
  loadingLabel: string;
  noResultsLabel: string;
  clearActionLabel: string;
  query: string;
  selectedItem: CardDesignerLookupItem | null;
  options: CardDesignerLookupItem[];
  isLoading: boolean;
  onQueryChange: (value: string) => void;
  onSelect: (item: CardDesignerLookupItem) => void;
  onClear: () => void;
};

function DesignerLookupField({
  label,
  searchPlaceholder,
  selectedPlaceholder,
  loadingLabel,
  noResultsLabel,
  clearActionLabel,
  query,
  selectedItem,
  options,
  isLoading,
  onQueryChange,
  onSelect,
  onClear,
}: DesignerLookupFieldProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase text-zinc-500">{label}</label>
      <Input
        value={query}
        placeholder={searchPlaceholder}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <div className="max-h-36 space-y-1 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-1">
        {isLoading ? (
          <p className="px-2 py-1 text-xs text-zinc-500">{loadingLabel}</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-1 text-xs text-zinc-500">{noResultsLabel}</p>
        ) : (
          options.map((item) => {
            const isSelected = selectedItem?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded-md border px-2 py-1 text-left text-xs transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-transparent bg-white text-zinc-700 hover:border-zinc-300"
                }`}
                onClick={() => onSelect(item)}
              >
                <p className="font-medium">{item.label}</p>
                <p className="text-[11px] text-zinc-500">{item.subtitle || "-"}</p>
              </button>
            );
          })
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] text-zinc-600">
          {selectedItem
            ? `${selectedItem.label}${selectedItem.subtitle ? ` · ${selectedItem.subtitle}` : ""}`
            : selectedPlaceholder}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onClear}
          disabled={!selectedItem && !query.trim()}
        >
          {clearActionLabel}
        </Button>
      </div>
    </div>
  );
}

function cloneEditableDesignPayload(payload: EditableDesignPayload): EditableDesignPayload {
  return JSON.parse(JSON.stringify(payload)) as EditableDesignPayload;
}

function getElementGroupId(element: EditableDesignElement): string | null {
  const groupId = element.metadata?.group_id;
  if (typeof groupId !== "string") {
    return null;
  }
  const normalized = groupId.trim();
  return normalized ? normalized : null;
}

function withGroupId(element: EditableDesignElement, groupId: string | null): EditableDesignElement {
  const metadata = isPlainObject(element.metadata) ? { ...element.metadata } : {};
  if (groupId) {
    metadata.group_id = groupId;
  } else {
    delete metadata.group_id;
  }
  return {
    ...element,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function createGroupId() {
  return `group-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function getElementBounds(element: EditableDesignElement): ElementBounds {
  const left = element.x_mm;
  const top = element.y_mm;
  const width = Math.max(0, element.width_mm);
  const height = Math.max(0, element.height_mm);
  const right = left + width;
  const bottom = top + height;
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

function getBoundsForElements(elements: EditableDesignElement[]): ElementBounds | null {
  if (elements.length === 0) {
    return null;
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const bounds = getElementBounds(element);
    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  }
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

function shiftBounds(bounds: ElementBounds, deltaX: number, deltaY: number): ElementBounds {
  return {
    left: bounds.left + deltaX,
    top: bounds.top + deltaY,
    right: bounds.right + deltaX,
    bottom: bounds.bottom + deltaY,
    centerX: bounds.centerX + deltaX,
    centerY: bounds.centerY + deltaY,
    width: bounds.width,
    height: bounds.height,
  };
}

function toUniqueSortedNumbers(values: number[]): number[] {
  const unique = new Set<number>();
  for (const value of values) {
    if (Number.isFinite(value)) {
      unique.add(roundMm(value));
    }
  }
  return Array.from(unique.values()).sort((a, b) => a - b);
}

function buildSnapTargets(
  elements: EditableDesignElement[],
  excludedIds: Set<string>
): { vertical: number[]; horizontal: number[] } {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (const element of elements) {
    if (excludedIds.has(element.id)) {
      continue;
    }
    const bounds = getElementBounds(element);
    vertical.push(bounds.left, bounds.centerX, bounds.right);
    horizontal.push(bounds.top, bounds.centerY, bounds.bottom);
  }
  return {
    vertical: toUniqueSortedNumbers(vertical),
    horizontal: toUniqueSortedNumbers(horizontal),
  };
}

function nearestGridValue(value: number, gridSizeMm: number): number {
  if (!Number.isFinite(gridSizeMm) || gridSizeMm <= 0) {
    return value;
  }
  const quotient = Math.round(value / gridSizeMm);
  return roundMm(quotient * gridSizeMm);
}

function findBestSnapAdjustment(
  candidateValues: number[],
  targetValues: number[],
  thresholdMm: number
): { adjustment: number; lineValueMm: number } | null {
  let bestAdjustment = Number.POSITIVE_INFINITY;
  let bestLineValue = 0;
  for (const candidate of candidateValues) {
    for (const target of targetValues) {
      const delta = target - candidate;
      if (Math.abs(delta) > thresholdMm) {
        continue;
      }
      if (Math.abs(delta) < Math.abs(bestAdjustment)) {
        bestAdjustment = delta;
        bestLineValue = target;
      }
    }
  }
  if (!Number.isFinite(bestAdjustment)) {
    return null;
  }
  return {
    adjustment: bestAdjustment,
    lineValueMm: bestLineValue,
  };
}

function isEventFromEditableField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function normalizeElementStyle(element: EditableDesignElement | null): Record<string, unknown> {
  if (!element || !isPlainObject(element.style)) {
    return {};
  }
  if (element.type === "shape") {
    return normalizeShapeGradientStyleForSave(element.style);
  }
  return { ...element.style };
}

function getStyleStringValue(
  style: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const value = style[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback;
}

function getStyleGlobalRadiusValue(style: Record<string, unknown>): string {
  const borderRadius = getStyleStringValue(style, "border_radius_mm");
  if (borderRadius.length > 0) {
    return borderRadius;
  }
  return getStyleStringValue(style, "corner_radius_mm");
}

function getStyleCornerRadiusValue(style: Record<string, unknown>, key: CornerRadiusStyleKey): string {
  const directValue = getStyleStringValue(style, key);
  if (directValue.length > 0) {
    return directValue;
  }
  return getStyleGlobalRadiusValue(style);
}

function buildCornerRadiusStylePatch(
  style: Record<string, unknown>,
  key: CornerRadiusStyleKey,
  value: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const globalFallback = getStyleGlobalRadiusValue(style);
  for (const cornerKey of CORNER_RADIUS_STYLE_KEYS) {
    const directValue = getStyleStringValue(style, cornerKey);
    const effectiveValue = directValue.length > 0 ? directValue : globalFallback;
    patch[cornerKey] = effectiveValue.length > 0 ? effectiveValue : undefined;
  }
  patch[key] = value;
  return patch;
}

function getStyleBooleanValue(
  style: Record<string, unknown>,
  key: string,
  fallback = false
): boolean {
  const value = style[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function sanitizeStyleValue(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    return normalized;
  }
  return value;
}

function parseOptionalInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
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

function createEmptyEditableDesignPayload(): EditableDesignPayload {
  return {
    elements: [],
    metadata: { unit: "mm" },
  };
}

function normalizeDesignPayload(payload: CardDesignPayload | null | undefined): EditableDesignPayload {
  const metadata = isPlainObject(payload?.metadata) ? payload?.metadata : { unit: "mm" };
  const background =
    typeof payload?.background === "string"
      ? payload.background
      : isPlainObject(payload?.background)
        ? payload.background
        : undefined;
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
    ...(typeof background === "string" || isPlainObject(background) ? { background } : {}),
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
        const normalizedStyle =
          element.type === "shape"
            ? normalizeShapeGradientStyleForSave(element.style)
            : element.style;
        sanitized.style = normalizedStyle;
      }
      if (isPlainObject(element.metadata)) {
        sanitized.metadata = element.metadata;
      }
      return sanitized;
    }),
    metadata: isPlainObject(payload.metadata) ? payload.metadata : { unit: "mm" },
    ...(typeof payload.background === "string" || isPlainObject(payload.background)
      ? { background: payload.background }
      : {}),
  };
}

function normalizeDesignPayloadBySide(
  payload: CardDesignPayload | null | undefined
): EditableDesignPayloadBySide {
  const normalizedFrontFallback = normalizeDesignPayload(payload);
  const rawSides = isPlainObject(payload?.sides) ? payload.sides : null;
  const rawFront = rawSides && isPlainObject(rawSides.front) ? rawSides.front : null;
  const rawBack = rawSides && isPlainObject(rawSides.back) ? rawSides.back : null;

  const front = rawFront
    ? normalizeDesignPayload({
        elements: Array.isArray(rawFront.elements) ? rawFront.elements : normalizedFrontFallback.elements,
        metadata: isPlainObject(rawFront.metadata)
          ? rawFront.metadata
          : normalizedFrontFallback.metadata,
        background:
          typeof rawFront.background === "string" || isPlainObject(rawFront.background)
            ? rawFront.background
            : normalizedFrontFallback.background,
      })
    : normalizedFrontFallback;

  const back = rawBack
    ? normalizeDesignPayload({
        elements: Array.isArray(rawBack.elements) ? rawBack.elements : [],
        metadata: isPlainObject(rawBack.metadata)
          ? rawBack.metadata
          : isPlainObject(front.metadata)
            ? front.metadata
            : { unit: "mm" },
        background:
          typeof rawBack.background === "string" || isPlainObject(rawBack.background)
            ? rawBack.background
            : undefined,
      })
    : {
        elements: [],
        metadata: isPlainObject(front.metadata) ? front.metadata : { unit: "mm" },
      };

  return {
    front,
    back,
  };
}

function sanitizePayloadBySideForSave(payloadBySide: EditableDesignPayloadBySide): CardDesignPayload {
  const frontPayload = sanitizePayloadForSave(payloadBySide.front);
  const backPayload = sanitizePayloadForSave(payloadBySide.back);

  const frontMetadata = isPlainObject(frontPayload.metadata) ? frontPayload.metadata : { unit: "mm" };
  const backMetadata = isPlainObject(backPayload.metadata) ? backPayload.metadata : { unit: "mm" };

  return {
    schema_version: 2,
    elements: frontPayload.elements,
    metadata: frontMetadata,
    ...(typeof frontPayload.background === "string" || isPlainObject(frontPayload.background)
      ? { background: frontPayload.background }
      : {}),
    sides: {
      front: {
        elements: frontPayload.elements,
        metadata: frontMetadata,
        ...(typeof frontPayload.background === "string" || isPlainObject(frontPayload.background)
          ? { background: frontPayload.background }
          : {}),
      },
      back: {
        elements: backPayload.elements,
        metadata: backMetadata,
        ...(typeof backPayload.background === "string" || isPlainObject(backPayload.background)
          ? { background: backPayload.background }
          : {}),
      },
    },
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

function collectUnknownMergeFieldsBySide(
  payloadBySide: EditableDesignPayloadBySide,
  allowedMergeFieldKeys: Set<string>
) {
  const unknown = new Set<string>();
  for (const side of CARD_SIDES) {
    for (const key of collectUnknownMergeFields(payloadBySide[side], allowedMergeFieldKeys)) {
      unknown.add(key);
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
  const [fontAssets, setFontAssets] = useState<CardFontAsset[]>([]);
  const [imageAssets, setImageAssets] = useState<CardImageAsset[]>([]);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [assetLibraryTab, setAssetLibraryTab] = useState<"fonts" | "images">("fonts");
  const [newFontAssetName, setNewFontAssetName] = useState("");
  const [newFontAssetFile, setNewFontAssetFile] = useState<File | null>(null);
  const [isUploadingFontAsset, setIsUploadingFontAsset] = useState(false);
  const [newImageAssetName, setNewImageAssetName] = useState("");
  const [newImageAssetFile, setNewImageAssetFile] = useState<File | null>(null);
  const [isUploadingImageAsset, setIsUploadingImageAsset] = useState(false);
  const selectedFontAssetFileRef = useRef<File | null>(null);
  const selectedImageAssetFileRef = useRef<File | null>(null);
  const fontAssetInputRef = useRef<HTMLInputElement | null>(null);
  const imageAssetInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [activeSide, setActiveSide] = useState<CardSide>(DEFAULT_ACTIVE_SIDE);
  const [designPayloadBySide, setDesignPayloadBySide] = useState<EditableDesignPayloadBySide>(() => ({
    front: createEmptyEditableDesignPayload(),
    back: createEmptyEditableDesignPayload(),
  }));
  const [designPayload, setDesignPayload] = useState<EditableDesignPayload>(() =>
    createEmptyEditableDesignPayload()
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [snapGuideLines, setSnapGuideLines] = useState<SnapGuideLine[]>([]);
  const [liveMeasurementBounds, setLiveMeasurementBounds] = useState<ElementBounds | null>(null);
  const [showRulers, setShowRulers] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSizeMmInput, setGridSizeMmInput] = useState(DEFAULT_GRID_SIZE_MM);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapToElements, setSnapToElements] = useState(true);
  const [snapThresholdMmInput, setSnapThresholdMmInput] = useState(DEFAULT_SNAP_THRESHOLD_MM);
  const [showBleedGuide, setShowBleedGuide] = useState(true);
  const [showSafeAreaGuide, setShowSafeAreaGuide] = useState(true);
  const [bleedGuideMmInput, setBleedGuideMmInput] = useState(DEFAULT_BLEED_MM);
  const [safeAreaGuideMmInput, setSafeAreaGuideMmInput] = useState(DEFAULT_SAFE_AREA_MM);
  const [previewMemberLookupQuery, setPreviewMemberLookupQuery] = useState("");
  const [previewLicenseLookupQuery, setPreviewLicenseLookupQuery] = useState("");
  const [previewClubLookupQuery, setPreviewClubLookupQuery] = useState("");
  const [previewMemberLookupOptions, setPreviewMemberLookupOptions] = useState<
    CardDesignerLookupItem[]
  >([]);
  const [previewLicenseLookupOptions, setPreviewLicenseLookupOptions] = useState<
    CardDesignerLookupItem[]
  >([]);
  const [previewClubLookupOptions, setPreviewClubLookupOptions] = useState<
    CardDesignerLookupItem[]
  >([]);
  const [previewSelectedMember, setPreviewSelectedMember] = useState<CardDesignerLookupItem | null>(
    null
  );
  const [previewSelectedLicense, setPreviewSelectedLicense] = useState<
    CardDesignerLookupItem | null
  >(null);
  const [previewSelectedClub, setPreviewSelectedClub] = useState<CardDesignerLookupItem | null>(
    null
  );
  const [isLoadingMemberLookup, setIsLoadingMemberLookup] = useState(false);
  const [isLoadingLicenseLookup, setIsLoadingLicenseLookup] = useState(false);
  const [isLoadingClubLookup, setIsLoadingClubLookup] = useState(false);
  const [isAdvancedPreviewMode, setIsAdvancedPreviewMode] = useState(false);
  const [previewSampleDataInput, setPreviewSampleDataInput] = useState("{}");
  const [previewPaperProfileValue, setPreviewPaperProfileValue] = useState(
    TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE
  );
  const [previewSelectedSlots, setPreviewSelectedSlots] = useState<number[]>([]);
  const [previewData, setPreviewData] = useState<CardPreviewDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isPublishingDraft, setIsPublishingDraft] = useState(false);
  const [isLoadingPreviewData, setIsLoadingPreviewData] = useState(false);
  const [isOpeningCardPreviewPdf, setIsOpeningCardPreviewPdf] = useState(false);
  const [isOpeningSheetPreviewPdf, setIsOpeningSheetPreviewPdf] = useState(false);
  const [isLivePrintSimulationEnabled, setIsLivePrintSimulationEnabled] = useState(false);
  const [isLoadingLiveSimulation, setIsLoadingLiveSimulation] = useState(false);
  const [liveSimulationData, setLiveSimulationData] = useState<CardPreviewHtmlResponse | null>(null);
  const [liveSimulationError, setLiveSimulationError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const historyPastRef = useRef<EditableDesignPayload[]>([]);
  const historyFutureRef = useRef<EditableDesignPayload[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);

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

  const paperProfilesForSelectedCardFormat = useMemo(() => {
    if (!selectedCardFormat) {
      return [];
    }
    return paperProfiles.filter((paperProfile) => paperProfile.card_format === selectedCardFormat.id);
  }, [paperProfiles, selectedCardFormat]);

  const previewPaperProfileOverride = useMemo(() => {
    if (previewPaperProfileValue === TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE) {
      return null;
    }
    const parsedId = Number(previewPaperProfileValue);
    if (!Number.isFinite(parsedId)) {
      return null;
    }
    return paperProfileById.get(parsedId) ?? null;
  }, [paperProfileById, previewPaperProfileValue]);

  const effectivePreviewPaperProfile = previewPaperProfileOverride ?? selectedPaperProfile;

  const canvasWidthMm = CONTRACT_CARD_WIDTH_MM;
  const canvasHeightMm = CONTRACT_CARD_HEIGHT_MM;
  const canvasScale = useMemo(() => {
    const widthScale = 760 / Math.max(canvasWidthMm, 1);
    const heightScale = 520 / Math.max(canvasHeightMm, 1);
    return clamp(Math.min(widthScale, heightScale), 2.2, 8);
  }, [canvasHeightMm, canvasWidthMm]);
  const canvasWidthPx = canvasWidthMm * canvasScale;
  const canvasHeightPx = canvasHeightMm * canvasScale;
  const bleedGuideMm = Math.max(0, toFiniteNumber(bleedGuideMmInput, Number(DEFAULT_BLEED_MM)));
  const safeAreaGuideMm = Math.max(
    0,
    toFiniteNumber(safeAreaGuideMmInput, Number(DEFAULT_SAFE_AREA_MM))
  );
  const bleedPx = bleedGuideMm * canvasScale;
  const safeAreaPx = safeAreaGuideMm * canvasScale;
  const gridSizeMm = Math.max(0.1, toFiniteNumber(gridSizeMmInput, Number(DEFAULT_GRID_SIZE_MM)));
  const snapThresholdMm = Math.max(
    0.2,
    toFiniteNumber(snapThresholdMmInput, Number(DEFAULT_SNAP_THRESHOLD_MM))
  );
  const gridSpacingPx = Math.max(2, gridSizeMm * canvasScale);

  const effectiveSlotCount = useMemo(() => {
    if (previewData?.paper_profile?.slot_count) {
      return previewData.paper_profile.slot_count;
    }
    if (effectivePreviewPaperProfile?.slot_count) {
      return effectivePreviewPaperProfile.slot_count;
    }
    return 0;
  }, [effectivePreviewPaperProfile, previewData?.paper_profile?.slot_count]);

  const slotGridColumns = useMemo(() => {
    if (previewData?.paper_profile?.columns) {
      return previewData.paper_profile.columns;
    }
    if (effectivePreviewPaperProfile?.columns) {
      return effectivePreviewPaperProfile.columns;
    }
    return 1;
  }, [effectivePreviewPaperProfile, previewData?.paper_profile?.columns]);

  const effectivePreviewSelectedSlots = useMemo(() => {
    return normalizeSlotSelection(previewSelectedSlots, effectiveSlotCount);
  }, [effectiveSlotCount, previewSelectedSlots]);

  const sheetGeometryProfile = useMemo(
    () => buildSheetGeometryProfile(previewData?.paper_profile, effectivePreviewPaperProfile),
    [effectivePreviewPaperProfile, previewData?.paper_profile]
  );

  const calculatedSheetSlots = useMemo(() => {
    if (!sheetGeometryProfile) {
      return [];
    }
    return buildSheetSlotsFromProfile(sheetGeometryProfile, effectivePreviewSelectedSlots);
  }, [effectivePreviewSelectedSlots, sheetGeometryProfile]);

  const backendSheetSlots = useMemo(() => {
    if (!Array.isArray(previewData?.slots) || previewData.slots.length === 0) {
      return [];
    }
    return previewData.slots.map((slot) => normalizePreviewSheetSlot(slot));
  }, [previewData?.slots]);

  const sheetPreviewSlots = useMemo(() => {
    if (backendSheetSlots.length > 0) {
      return backendSheetSlots;
    }
    return calculatedSheetSlots;
  }, [backendSheetSlots, calculatedSheetSlots]);

  const sheetPreviewScale = useMemo(() => {
    if (!sheetGeometryProfile) {
      return 1;
    }
    const widthScale = SHEET_PREVIEW_MAX_WIDTH_PX / Math.max(sheetGeometryProfile.sheet_width_mm, 1);
    const heightScale =
      SHEET_PREVIEW_MAX_HEIGHT_PX / Math.max(sheetGeometryProfile.sheet_height_mm, 1);
    return clamp(Math.min(widthScale, heightScale), 1, 3.5);
  }, [sheetGeometryProfile]);

  const sheetPreviewWidthPx = (sheetGeometryProfile?.sheet_width_mm || 0) * sheetPreviewScale;
  const sheetPreviewHeightPx = (sheetGeometryProfile?.sheet_height_mm || 0) * sheetPreviewScale;

  const sheetRulerMarksX = useMemo(() => {
    if (!sheetGeometryProfile) {
      return [];
    }
    return Array.from(
      { length: Math.floor(sheetGeometryProfile.sheet_width_mm / 10) + 1 },
      (_, index) => index * 10
    );
  }, [sheetGeometryProfile]);

  const sheetRulerMarksY = useMemo(() => {
    if (!sheetGeometryProfile) {
      return [];
    }
    return Array.from(
      { length: Math.floor(sheetGeometryProfile.sheet_height_mm / 10) + 1 },
      (_, index) => index * 10
    );
  }, [sheetGeometryProfile]);

  const sheetLayoutMetadata = useMemo(() => {
    if (previewData?.layout_metadata) {
      const maxX = toFiniteNumber(previewData.layout_metadata.max_x_mm, 0);
      const maxY = toFiniteNumber(previewData.layout_metadata.max_y_mm, 0);
      const sheetWidth = toFiniteNumber(previewData.layout_metadata.sheet_width_mm, 0);
      const sheetHeight = toFiniteNumber(previewData.layout_metadata.sheet_height_mm, 0);
      return {
        max_x_mm: roundMm(maxX),
        max_y_mm: roundMm(maxY),
        sheet_width_mm: roundMm(sheetWidth),
        sheet_height_mm: roundMm(sheetHeight),
        within_sheet_bounds: Boolean(previewData.layout_metadata.within_sheet_bounds),
      };
    }
    if (!sheetGeometryProfile) {
      return null;
    }
    const maxX = sheetPreviewSlots.reduce((maxValue, slot) => Math.max(maxValue, slot.x_end_mm), 0);
    const maxY = sheetPreviewSlots.reduce((maxValue, slot) => Math.max(maxValue, slot.y_end_mm), 0);
    return {
      max_x_mm: roundMm(maxX),
      max_y_mm: roundMm(maxY),
      sheet_width_mm: roundMm(sheetGeometryProfile.sheet_width_mm),
      sheet_height_mm: roundMm(sheetGeometryProfile.sheet_height_mm),
      within_sheet_bounds:
        maxX <= sheetGeometryProfile.sheet_width_mm && maxY <= sheetGeometryProfile.sheet_height_mm,
    };
  }, [previewData?.layout_metadata, sheetGeometryProfile, sheetPreviewSlots]);

  const sheetGeometryParityIssues = useMemo(() => {
    if (backendSheetSlots.length === 0 || calculatedSheetSlots.length === 0) {
      return [];
    }
    return compareSheetSlotGeometry(backendSheetSlots, calculatedSheetSlots);
  }, [backendSheetSlots, calculatedSheetSlots]);

  const allElementIds = useMemo(() => {
    return new Set(designPayload.elements.map((element) => element.id));
  }, [designPayload.elements]);

  const effectiveSelectedElementIds = useMemo(() => {
    const fromMulti = selectedElementIds.filter((id) => allElementIds.has(id));
    if (fromMulti.length > 0) {
      return fromMulti;
    }
    if (selectedElementId && allElementIds.has(selectedElementId)) {
      return [selectedElementId];
    }
    return [];
  }, [allElementIds, selectedElementId, selectedElementIds]);

  const selectedElements = useMemo(() => {
    if (effectiveSelectedElementIds.length === 0) {
      return [];
    }
    const selectedSet = new Set(effectiveSelectedElementIds);
    return designPayload.elements.filter((element) => selectedSet.has(element.id));
  }, [designPayload.elements, effectiveSelectedElementIds]);

  const selectedElement = useMemo(() => {
    if (!selectedElementId) {
      return selectedElements[0] ?? null;
    }
    return (
      designPayload.elements.find((element) => element.id === selectedElementId) ??
      selectedElements[0] ??
      null
    );
  }, [designPayload.elements, selectedElementId, selectedElements]);

  const selectedElementStyle = useMemo(
    () => normalizeElementStyle(selectedElement),
    [selectedElement]
  );

  const selectedFontAssetId = useMemo(
    () => parseOptionalInt(selectedElementStyle.font_asset_id),
    [selectedElementStyle]
  );

  const selectedImageAssetId = useMemo(
    () => parseOptionalInt(selectedElementStyle.image_asset_id),
    [selectedElementStyle]
  );
  const selectedImageAsset = useMemo(() => {
    if (!selectedImageAssetId || selectedImageAssetId <= 0) {
      return null;
    }
    return imageAssets.find((asset) => asset.id === selectedImageAssetId) ?? null;
  }, [imageAssets, selectedImageAssetId]);
  const selectedImageAssetIsSvg = useMemo(() => {
    if (!selectedImageAsset) {
      return false;
    }
    return String(selectedImageAsset.image || "").trim().toLowerCase().endsWith(".svg");
  }, [selectedImageAsset]);

  const selectedQrMergeFields = useMemo(() => {
    const rawValue = selectedElementStyle.merge_fields;
    if (Array.isArray(rawValue)) {
      return rawValue
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0);
    }
    if (Array.isArray(selectedElement?.merge_fields)) {
      return selectedElement.merge_fields
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0);
    }
    return [];
  }, [selectedElement, selectedElementStyle]);

  const selectedImageSourceMode = useMemo(() => {
    if (selectedImageAssetId && selectedImageAssetId > 0) {
      return "asset";
    }
    if (selectedElement?.type === "image" && selectedElement.merge_field) {
      return "merge";
    }
    return "source";
  }, [selectedElement, selectedImageAssetId]);

  const selectedShapeGradientState = useMemo(
    () => resolveShapeGradientState(selectedElementStyle),
    [selectedElementStyle]
  );
  const selectedShapeUsesGradient = selectedShapeGradientState.enabled;

  const selectedQrDataMode = useMemo(() => {
    const mode = getStyleStringValue(selectedElementStyle, "data_mode", "").toLowerCase();
    if (QR_DATA_MODE_OPTIONS.includes(mode as (typeof QR_DATA_MODE_OPTIONS)[number])) {
      return mode as (typeof QR_DATA_MODE_OPTIONS)[number];
    }
    return selectedQrMergeFields.length > 0 ? "multi_merge" : "single_merge";
  }, [selectedElementStyle, selectedQrMergeFields.length]);

  const mergeFieldKeySet = useMemo(() => {
    return new Set(mergeFields.map((field) => field.key));
  }, [mergeFields]);

  const isEditableDraft = canManageDesigner && selectedVersion?.status === "draft";
  const canUndo = historyRevision >= 0 && historyPastRef.current.length > 0;
  const canRedo = historyRevision >= 0 && historyFutureRef.current.length > 0;
  const sideLabelByValue = useMemo(
    () => ({
      front: t("licenseCardDesignerSideFrontLabel"),
      back: t("licenseCardDesignerSideBackLabel"),
    }),
    [t]
  );
  const activeSideLabel = sideLabelByValue[activeSide];
  const synchronizedPayloadBySide = useMemo(
    () => ({
      ...designPayloadBySide,
      [activeSide]: designPayload,
    }),
    [activeSide, designPayload, designPayloadBySide]
  );
  const savedPayloadSnapshot = useMemo(() => {
    if (!selectedVersion) {
      return null;
    }
    return JSON.stringify(
      sanitizePayloadBySideForSave(normalizeDesignPayloadBySide(selectedVersion.design_payload))
    );
  }, [selectedVersion]);
  const currentPayloadSnapshot = useMemo(
    () => JSON.stringify(sanitizePayloadBySideForSave(synchronizedPayloadBySide)),
    [synchronizedPayloadBySide]
  );
  const isDirty = useMemo(() => {
    if (!selectedVersion || selectedVersion.status !== "draft" || !savedPayloadSnapshot) {
      return false;
    }
    return savedPayloadSnapshot !== currentPayloadSnapshot;
  }, [currentPayloadSnapshot, savedPayloadSnapshot, selectedVersion]);
  const localSideSummary = useMemo(() => {
    const summary = {} as Record<CardSide, CardSideSummaryInfo>;
    for (const side of CARD_SIDES) {
      const sidePayload = synchronizedPayloadBySide[side];
      const elementCount = Array.isArray(sidePayload.elements) ? sidePayload.elements.length : 0;
      const hasBackground = Boolean(sidePayload.background);
      summary[side] = {
        element_count: elementCount,
        has_background: hasBackground,
        has_content: elementCount > 0 || hasBackground,
        is_active: side === activeSide,
      };
    }
    return summary;
  }, [activeSide, synchronizedPayloadBySide]);
  const previewAvailableSides = useMemo(() => {
    const available = previewData?.available_sides;
    if (!Array.isArray(available) || available.length === 0) {
      return CARD_SIDES;
    }
    return available.filter((side): side is CardSide => side === "front" || side === "back");
  }, [previewData?.available_sides]);
  const liveSimulationSrcDoc = useMemo(
    () => buildCardSimulationSrcDoc(liveSimulationData),
    [liveSimulationData]
  );

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setHistoryRevision((value) => value + 1);
  }, []);

  const pushHistorySnapshot = useCallback((payload: EditableDesignPayload) => {
    historyPastRef.current.push(cloneEditableDesignPayload(payload));
    if (historyPastRef.current.length > HISTORY_STACK_LIMIT) {
      historyPastRef.current.shift();
    }
    historyFutureRef.current = [];
    setHistoryRevision((value) => value + 1);
  }, []);

  const applyDesignMutation = useCallback(
    (
      updater: (payload: EditableDesignPayload) => EditableDesignPayload,
      options?: { recordHistory?: boolean }
    ) => {
      setDesignPayload((previousPayload) => {
        const nextPayload = updater(previousPayload);
        if (nextPayload === previousPayload) {
          return previousPayload;
        }
        if (options?.recordHistory !== false) {
          pushHistorySnapshot(previousPayload);
        }
        return nextPayload;
      });
    },
    [pushHistorySnapshot]
  );

  const clearElementSelection = useCallback(() => {
    setSelectedElementIds([]);
    setSelectedElementId(null);
  }, []);

  const setSingleElementSelection = useCallback((elementId: string) => {
    setSelectedElementIds([elementId]);
    setSelectedElementId(elementId);
  }, []);

  const toggleElementSelection = useCallback((elementId: string) => {
    setSelectedElementIds((previousSelectedIds) => {
      const selectedSet = new Set(previousSelectedIds);
      if (selectedSet.has(elementId)) {
        selectedSet.delete(elementId);
      } else {
        selectedSet.add(elementId);
      }
      const nextIds = Array.from(selectedSet.values());
      setSelectedElementId(nextIds.length > 0 ? elementId : null);
      return nextIds;
    });
  }, []);

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
          fontAssetResponse,
          imageAssetResponse,
        ] = await Promise.all([
          getCardTemplate(templateId),
          getCardTemplateVersions({ templateId }),
          getCardFormats(),
          getPaperProfiles(),
          getMergeFields(),
          getCardFontAssets(),
          getCardImageAssets(),
        ]);

        const versionsSorted = [...versionResponse].sort(versionSortDesc);
        setTemplate(templateResponse);
        setVersions(versionsSorted);
        setCardFormats(cardFormatResponse);
        setPaperProfiles(paperProfileResponse);
        setMergeFields(mergeFieldResponse);
        setFontAssets(fontAssetResponse);
        setImageAssets(imageAssetResponse);
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
      const emptyBySide: EditableDesignPayloadBySide = {
        front: createEmptyEditableDesignPayload(),
        back: createEmptyEditableDesignPayload(),
      };
      setActiveSide(DEFAULT_ACTIVE_SIDE);
      setDesignPayloadBySide(emptyBySide);
      setDesignPayload(cloneEditableDesignPayload(emptyBySide.front));
      setSelectedElementIds([]);
      setSelectedElementId(null);
      setPreviewData(null);
      setLiveSimulationData(null);
      setLiveSimulationError(null);
      setPreviewSelectedSlots([]);
      setPreviewPaperProfileValue(TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE);
      resetHistory();
      return;
    }
    const normalizedBySide = normalizeDesignPayloadBySide(selectedVersion.design_payload);
    setActiveSide(DEFAULT_ACTIVE_SIDE);
    setDesignPayloadBySide(normalizedBySide);
    setDesignPayload(cloneEditableDesignPayload(normalizedBySide.front));
    setSelectedElementIds([]);
    setSelectedElementId(null);
    setPreviewData(null);
    setLiveSimulationData(null);
    setLiveSimulationError(null);
    setDragState(null);
    setResizeState(null);
    setSnapGuideLines([]);
    setLiveMeasurementBounds(null);
    resetHistory();
    setPreviewPaperProfileValue((previousValue) => {
      if (previousValue === TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE) {
        return previousValue;
      }
      const parsed = Number(previousValue);
      const matchesCardFormat = paperProfilesForSelectedCardFormat.some(
        (paperProfile) => paperProfile.id === parsed
      );
      return matchesCardFormat ? previousValue : TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE;
    });
  }, [paperProfilesForSelectedCardFormat, resetHistory, selectedVersion]);

  useEffect(() => {
    setDesignPayloadBySide((previousPayloadBySide) => {
      if (previousPayloadBySide[activeSide] === designPayload) {
        return previousPayloadBySide;
      }
      return {
        ...previousPayloadBySide,
        [activeSide]: designPayload,
      };
    });
  }, [activeSide, designPayload]);

  useEffect(() => {
    setSelectedElementIds((previousIds) => {
      const filteredIds = previousIds.filter((id) => allElementIds.has(id));
      setSelectedElementId((previousId) => {
        if (previousId && allElementIds.has(previousId)) {
          return previousId;
        }
        return filteredIds[filteredIds.length - 1] ?? null;
      });
      if (filteredIds.length === previousIds.length) {
        return previousIds;
      }
      return filteredIds;
    });
  }, [allElementIds]);

  useEffect(() => {
    if (effectiveSlotCount <= 0) {
      setPreviewSelectedSlots([]);
      return;
    }
    setPreviewSelectedSlots((previousSlots) => {
      const normalized = normalizeSlotSelection(previousSlots, effectiveSlotCount);
      if (normalized.length > 0) {
        return normalized;
      }
      return Array.from({ length: effectiveSlotCount }, (_, index) => index);
    });
  }, [effectiveSlotCount]);

  useEffect(() => {
    if (!canManageDesigner) {
      setPreviewMemberLookupOptions([]);
      setIsLoadingMemberLookup(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadLookup = async () => {
        setIsLoadingMemberLookup(true);
        try {
          const response = await getCardDesignerMemberLookups(
            {
              q: previewMemberLookupQuery.trim(),
              limit: PREVIEW_LOOKUP_LIMIT,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) {
            return;
          }
          setPreviewMemberLookupOptions(response);
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          setPreviewMemberLookupOptions([]);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingMemberLookup(false);
          }
        }
      };
      void loadLookup();
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [canManageDesigner, previewMemberLookupQuery]);

  useEffect(() => {
    if (!canManageDesigner) {
      setPreviewLicenseLookupOptions([]);
      setIsLoadingLicenseLookup(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadLookup = async () => {
        setIsLoadingLicenseLookup(true);
        try {
          const response = await getCardDesignerLicenseLookups(
            {
              q: previewLicenseLookupQuery.trim(),
              limit: PREVIEW_LOOKUP_LIMIT,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) {
            return;
          }
          setPreviewLicenseLookupOptions(response);
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          setPreviewLicenseLookupOptions([]);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingLicenseLookup(false);
          }
        }
      };
      void loadLookup();
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [canManageDesigner, previewLicenseLookupQuery]);

  useEffect(() => {
    if (!canManageDesigner) {
      setPreviewClubLookupOptions([]);
      setIsLoadingClubLookup(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadLookup = async () => {
        setIsLoadingClubLookup(true);
        try {
          const response = await getCardDesignerClubLookups(
            {
              q: previewClubLookupQuery.trim(),
              limit: PREVIEW_LOOKUP_LIMIT,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) {
            return;
          }
          setPreviewClubLookupOptions(response);
        } catch {
          if (controller.signal.aborted) {
            return;
          }
          setPreviewClubLookupOptions([]);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingClubLookup(false);
          }
        }
      };
      void loadLookup();
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [canManageDesigner, previewClubLookupQuery]);

  useEffect(() => {
    if (!dragState || !isEditableDraft) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) {
        return;
      }
      const activeStartPosition = dragState.startPositions[dragState.elementId];
      if (!activeStartPosition) {
        return;
      }

      const pointerX = event.clientX - canvasRect.left;
      const pointerY = event.clientY - canvasRect.top;
      const rawActiveX_mm = (pointerX - dragState.pointerOffsetX) / canvasScale;
      const rawActiveY_mm = (pointerY - dragState.pointerOffsetY) / canvasScale;
      let deltaX = rawActiveX_mm - activeStartPosition.x_mm;
      let deltaY = rawActiveY_mm - activeStartPosition.y_mm;

      const bounds = dragState.startSelectionBounds;
      deltaX = clamp(deltaX, -bounds.left, canvasWidthMm - bounds.right);
      deltaY = clamp(deltaY, -bounds.top, canvasHeightMm - bounds.bottom);

      const candidateBounds = shiftBounds(bounds, deltaX, deltaY);
      const nextGuideLines: SnapGuideLine[] = [];

      const xCandidates: Array<{ adjustment: number; line: SnapGuideLine }> = [];
      if (snapToGrid) {
        const snappedGridX = nearestGridValue(candidateBounds.left, gridSizeMm);
        xCandidates.push({
          adjustment: snappedGridX - candidateBounds.left,
          line: {
            orientation: "vertical",
            value_mm: snappedGridX,
            source: "grid",
          },
        });
      }
      if (snapToElements) {
        const elementSnap = findBestSnapAdjustment(
          [candidateBounds.left, candidateBounds.centerX, candidateBounds.right],
          dragState.snapTargets.vertical,
          snapThresholdMm
        );
        if (elementSnap) {
          xCandidates.push({
            adjustment: elementSnap.adjustment,
            line: {
              orientation: "vertical",
              value_mm: elementSnap.lineValueMm,
              source: "element",
            },
          });
        }
      }
      if (xCandidates.length > 0) {
        const bestX = xCandidates.reduce((best, candidate) =>
          Math.abs(candidate.adjustment) < Math.abs(best.adjustment) ? candidate : best
        );
        deltaX += bestX.adjustment;
        nextGuideLines.push(bestX.line);
      }

      const yCandidates: Array<{ adjustment: number; line: SnapGuideLine }> = [];
      if (snapToGrid) {
        const snappedGridY = nearestGridValue(candidateBounds.top, gridSizeMm);
        yCandidates.push({
          adjustment: snappedGridY - candidateBounds.top,
          line: {
            orientation: "horizontal",
            value_mm: snappedGridY,
            source: "grid",
          },
        });
      }
      if (snapToElements) {
        const elementSnap = findBestSnapAdjustment(
          [candidateBounds.top, candidateBounds.centerY, candidateBounds.bottom],
          dragState.snapTargets.horizontal,
          snapThresholdMm
        );
        if (elementSnap) {
          yCandidates.push({
            adjustment: elementSnap.adjustment,
            line: {
              orientation: "horizontal",
              value_mm: elementSnap.lineValueMm,
              source: "element",
            },
          });
        }
      }
      if (yCandidates.length > 0) {
        const bestY = yCandidates.reduce((best, candidate) =>
          Math.abs(candidate.adjustment) < Math.abs(best.adjustment) ? candidate : best
        );
        deltaY += bestY.adjustment;
        nextGuideLines.push(bestY.line);
      }

      deltaX = clamp(deltaX, -bounds.left, canvasWidthMm - bounds.right);
      deltaY = clamp(deltaY, -bounds.top, canvasHeightMm - bounds.bottom);

      applyDesignMutation(
        (previousPayload) => {
          const nextElements = previousPayload.elements.map((element) => {
            const startPosition = dragState.startPositions[element.id];
            if (!startPosition) {
              return element;
            }
            return clampElementToCanvas(
              {
                ...element,
                x_mm: startPosition.x_mm + deltaX,
                y_mm: startPosition.y_mm + deltaY,
              },
              canvasWidthMm,
              canvasHeightMm
            );
          });
          return {
            ...previousPayload,
            elements: nextElements,
          };
        },
        { recordHistory: false }
      );
      setLiveMeasurementBounds(shiftBounds(bounds, deltaX, deltaY));
      setSnapGuideLines(nextGuideLines);
    };

    const handleMouseUp = () => {
      setDragState(null);
      setSnapGuideLines([]);
      setLiveMeasurementBounds(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    applyDesignMutation,
    canvasHeightMm,
    canvasScale,
    canvasWidthMm,
    dragState,
    gridSizeMm,
    isEditableDraft,
    snapThresholdMm,
    snapToElements,
    snapToGrid,
  ]);

  useEffect(() => {
    if (!resizeState || !isEditableDraft) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const deltaX_mm = (event.clientX - resizeState.startPointerX) / canvasScale;
      const deltaY_mm = (event.clientY - resizeState.startPointerY) / canvasScale;

      let width = clamp(
        resizeState.startWidth_mm + deltaX_mm,
        0.5,
        canvasWidthMm - resizeState.startX_mm
      );
      let height = clamp(
        resizeState.startHeight_mm + deltaY_mm,
        0.5,
        canvasHeightMm - resizeState.startY_mm
      );

      const rawRight = resizeState.startX_mm + width;
      const rawBottom = resizeState.startY_mm + height;
      const nextGuideLines: SnapGuideLine[] = [];

      const xCandidates: Array<{ adjustment: number; line: SnapGuideLine }> = [];
      if (snapToGrid) {
        const snappedGridX = nearestGridValue(rawRight, gridSizeMm);
        xCandidates.push({
          adjustment: snappedGridX - rawRight,
          line: {
            orientation: "vertical",
            value_mm: snappedGridX,
            source: "grid",
          },
        });
      }
      if (snapToElements) {
        const elementSnap = findBestSnapAdjustment(
          [rawRight],
          resizeState.snapTargets.vertical,
          snapThresholdMm
        );
        if (elementSnap) {
          xCandidates.push({
            adjustment: elementSnap.adjustment,
            line: {
              orientation: "vertical",
              value_mm: elementSnap.lineValueMm,
              source: "element",
            },
          });
        }
      }
      if (xCandidates.length > 0) {
        const bestX = xCandidates.reduce((best, candidate) =>
          Math.abs(candidate.adjustment) < Math.abs(best.adjustment) ? candidate : best
        );
        width = clamp(
          rawRight + bestX.adjustment - resizeState.startX_mm,
          0.5,
          canvasWidthMm - resizeState.startX_mm
        );
        nextGuideLines.push(bestX.line);
      }

      const yCandidates: Array<{ adjustment: number; line: SnapGuideLine }> = [];
      if (snapToGrid) {
        const snappedGridY = nearestGridValue(rawBottom, gridSizeMm);
        yCandidates.push({
          adjustment: snappedGridY - rawBottom,
          line: {
            orientation: "horizontal",
            value_mm: snappedGridY,
            source: "grid",
          },
        });
      }
      if (snapToElements) {
        const elementSnap = findBestSnapAdjustment(
          [rawBottom],
          resizeState.snapTargets.horizontal,
          snapThresholdMm
        );
        if (elementSnap) {
          yCandidates.push({
            adjustment: elementSnap.adjustment,
            line: {
              orientation: "horizontal",
              value_mm: elementSnap.lineValueMm,
              source: "element",
            },
          });
        }
      }
      if (yCandidates.length > 0) {
        const bestY = yCandidates.reduce((best, candidate) =>
          Math.abs(candidate.adjustment) < Math.abs(best.adjustment) ? candidate : best
        );
        height = clamp(
          rawBottom + bestY.adjustment - resizeState.startY_mm,
          0.5,
          canvasHeightMm - resizeState.startY_mm
        );
        nextGuideLines.push(bestY.line);
      }

      const measuredBounds: ElementBounds = {
        left: resizeState.startX_mm,
        top: resizeState.startY_mm,
        width,
        height,
        right: resizeState.startX_mm + width,
        bottom: resizeState.startY_mm + height,
        centerX: resizeState.startX_mm + width / 2,
        centerY: resizeState.startY_mm + height / 2,
      };

      applyDesignMutation(
        (previousPayload) => ({
          ...previousPayload,
          elements: previousPayload.elements.map((element) => {
            if (element.id !== resizeState.elementId) {
              return element;
            }
            return clampElementToCanvas(
              {
                ...element,
                width_mm: width,
                height_mm: height,
              },
              canvasWidthMm,
              canvasHeightMm
            );
          }),
        }),
        { recordHistory: false }
      );
      setSnapGuideLines(nextGuideLines);
      setLiveMeasurementBounds(measuredBounds);
    };

    const handleMouseUp = () => {
      setResizeState(null);
      setSnapGuideLines([]);
      setLiveMeasurementBounds(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    applyDesignMutation,
    canvasHeightMm,
    canvasScale,
    canvasWidthMm,
    gridSizeMm,
    isEditableDraft,
    resizeState,
    snapThresholdMm,
    snapToElements,
    snapToGrid,
  ]);

  const updateSelectedElement = useCallback(
    (updater: (element: EditableDesignElement) => EditableDesignElement) => {
      if (!selectedElementId) {
        return;
      }
      applyDesignMutation((previousPayload) => {
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
    [applyDesignMutation, canvasHeightMm, canvasWidthMm, selectedElementId]
  );

  const setSelectedElementStylePatch = useCallback(
    (patch: Record<string, unknown>) => {
      updateSelectedElement((element) => {
        const nextStyle = normalizeElementStyle(element);
        for (const [key, rawValue] of Object.entries(patch)) {
          const sanitized = sanitizeStyleValue(rawValue);
          if (typeof sanitized === "undefined" || sanitized === null) {
            delete nextStyle[key];
          } else {
            nextStyle[key] = sanitized;
          }
        }
        return {
          ...element,
          style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
        };
      });
    },
    [updateSelectedElement]
  );

  const setSelectedElementField = useCallback(
    (key: keyof EditableDesignElement, value: unknown) => {
      updateSelectedElement((element) => {
        const nextElement = { ...element } as EditableDesignElement;
        const normalized = sanitizeStyleValue(value);
        if (typeof normalized === "undefined" || normalized === null) {
          delete (nextElement as Record<string, unknown>)[key];
        } else {
          (nextElement as Record<string, unknown>)[key] = normalized;
        }
        return nextElement;
      });
    },
    [updateSelectedElement]
  );

  const applyImageMergePreset = useCallback(
    (mergeField: string) => {
      updateSelectedElement((element) => {
        if (element.type !== "image") {
          return element;
        }
        const nextStyle = normalizeElementStyle(element);
        delete nextStyle.image_asset_id;
        return {
          ...element,
          merge_field: mergeField,
          source: undefined,
          style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
        };
      });
    },
    [updateSelectedElement]
  );

  const applySelectedImageAsset = useCallback(
    (assetId: number | null) => {
      updateSelectedElement((element) => {
        if (element.type !== "image") {
          return element;
        }
        const nextStyle = normalizeElementStyle(element);
        const hasAssetSelection =
          typeof assetId === "number" && Number.isFinite(assetId) && assetId > 0;
        if (hasAssetSelection) {
          nextStyle.image_asset_id = Math.trunc(assetId);
        } else {
          delete nextStyle.image_asset_id;
        }
        return {
          ...element,
          merge_field: hasAssetSelection ? undefined : element.merge_field,
          source: hasAssetSelection ? undefined : element.source,
          style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
        };
      });
    },
    [updateSelectedElement]
  );

  const switchActiveSide = useCallback(
    (nextSide: CardSide) => {
      if (nextSide === activeSide) {
        return;
      }
      const synchronized = {
        ...designPayloadBySide,
        [activeSide]: designPayload,
      };
      setDesignPayloadBySide(synchronized);
      setActiveSide(nextSide);
      setDesignPayload(cloneEditableDesignPayload(synchronized[nextSide]));
      setSelectedElementIds([]);
      setSelectedElementId(null);
      setDragState(null);
      setResizeState(null);
      setSnapGuideLines([]);
      setLiveMeasurementBounds(null);
      setPreviewData(null);
      setLiveSimulationData(null);
      setLiveSimulationError(null);
      resetHistory();
    },
    [activeSide, designPayload, designPayloadBySide, resetHistory]
  );

  const flipActiveSide = useCallback(() => {
    switchActiveSide(activeSide === "front" ? "back" : "front");
  }, [activeSide, switchActiveSide]);

  const copySidePayload = useCallback(
    (sourceSide: CardSide, destinationSide: CardSide) => {
      const synchronized = {
        ...designPayloadBySide,
        [activeSide]: designPayload,
      };
      const sourcePayload = synchronized[sourceSide];
      const nextBySide = {
        ...synchronized,
        [destinationSide]: cloneEditableDesignPayload(sourcePayload),
      };
      setDesignPayloadBySide(nextBySide);
      if (destinationSide === activeSide) {
        setDesignPayload(cloneEditableDesignPayload(nextBySide[destinationSide]));
      }
      setSuccessMessage(
        t("licenseCardDesignerSideCopySuccess", {
          source: sideLabelByValue[sourceSide],
          destination: sideLabelByValue[destinationSide],
        })
      );
      setErrorMessage(null);
    },
    [activeSide, designPayload, designPayloadBySide, sideLabelByValue, t]
  );

  const removeSelectedElement = useCallback(() => {
    if (!isEditableDraft || effectiveSelectedElementIds.length === 0) {
      return;
    }
    const selectedSet = new Set(effectiveSelectedElementIds);
    applyDesignMutation((previousPayload) => ({
      ...previousPayload,
      elements: previousPayload.elements.filter((element) => !selectedSet.has(element.id)),
    }));
    clearElementSelection();
  }, [applyDesignMutation, clearElementSelection, effectiveSelectedElementIds, isEditableDraft]);

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
    applyDesignMutation((previousPayload) => ({
      ...previousPayload,
      elements: [...previousPayload.elements, newElement],
    }));
    setSingleElementSelection(newElement.id);
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

  const resolveMoveTargetIds = useCallback(
    (elementId: string, payload: EditableDesignPayload, selectedIds: string[]) => {
      const selectedSet = new Set(selectedIds);
      const filteredSelectedIds = payload.elements
        .map((element) => element.id)
        .filter((id) => selectedSet.has(id));
      if (filteredSelectedIds.length > 1 && selectedSet.has(elementId)) {
        return filteredSelectedIds;
      }
      const element = payload.elements.find((entry) => entry.id === elementId);
      if (!element) {
        return [elementId];
      }
      const groupId = getElementGroupId(element);
      if (!groupId) {
        return [elementId];
      }
      const groupedIds = payload.elements
        .filter((entry) => getElementGroupId(entry) === groupId)
        .map((entry) => entry.id);
      return groupedIds.length > 1 ? groupedIds : [elementId];
    },
    []
  );

  const handleElementMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    element: EditableDesignElement
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    if (event.shiftKey) {
      toggleElementSelection(element.id);
      return;
    }

    const selectionForMove =
      effectiveSelectedElementIds.length > 1 && effectiveSelectedElementIds.includes(element.id)
        ? effectiveSelectedElementIds
        : [element.id];
    if (selectionForMove.length === 1) {
      setSingleElementSelection(element.id);
    } else {
      setSelectedElementId(element.id);
    }
    if (!isEditableDraft) {
      return;
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }
    const targetIds = resolveMoveTargetIds(element.id, designPayload, selectionForMove);
    const targetIdSet = new Set(targetIds);
    const targetElements = designPayload.elements.filter((entry) => targetIdSet.has(entry.id));
    const startSelectionBounds = getBoundsForElements(targetElements);
    if (!startSelectionBounds) {
      return;
    }
    const startPositions: Record<string, { x_mm: number; y_mm: number }> = {};
    for (const targetElement of targetElements) {
      startPositions[targetElement.id] = {
        x_mm: targetElement.x_mm,
        y_mm: targetElement.y_mm,
      };
    }

    pushHistorySnapshot(designPayload);
    const elementX = element.x_mm * canvasScale;
    const elementY = element.y_mm * canvasScale;
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;
    setResizeState(null);
    setSnapGuideLines([]);
    setLiveMeasurementBounds(startSelectionBounds);
    setDragState({
      elementId: element.id,
      targetIds,
      pointerOffsetX: pointerX - elementX,
      pointerOffsetY: pointerY - elementY,
      startPositions,
      startSelectionBounds,
      snapTargets: buildSnapTargets(designPayload.elements, targetIdSet),
    });
  };

  const handleResizeHandleMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>,
    element: EditableDesignElement
  ) => {
    if (event.button !== 0 || !isEditableDraft) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    setSingleElementSelection(element.id);
    pushHistorySnapshot(designPayload);
    setDragState(null);
    setSnapGuideLines([]);
    setLiveMeasurementBounds(getElementBounds(element));
    setResizeState({
      elementId: element.id,
      startX_mm: element.x_mm,
      startY_mm: element.y_mm,
      startWidth_mm: element.width_mm,
      startHeight_mm: element.height_mm,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      snapTargets: buildSnapTargets(designPayload.elements, new Set([element.id])),
    });
  };

  const persistDraftPayload = useCallback(
    async (versionId: number, payloadBySide: EditableDesignPayloadBySide) => {
      const unknownMergeFields = collectUnknownMergeFieldsBySide(payloadBySide, mergeFieldKeySet);
      if (unknownMergeFields.length > 0) {
        setErrorMessage(
          t("licenseCardDesignerUnknownMergeFieldsError", {
            fields: unknownMergeFields.join(", "),
          })
        );
        return null;
      }
      return updateCardTemplateVersion(versionId, {
        design_payload: sanitizePayloadBySideForSave(payloadBySide),
      });
    },
    [mergeFieldKeySet, t]
  );

  const handleSaveDraft = async () => {
    if (!selectedVersion || selectedVersion.status !== "draft") {
      setErrorMessage(t("licenseCardDesignerDraftOnlyError"));
      return;
    }

    setIsSavingDraft(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const updatedVersion = await persistDraftPayload(selectedVersion.id, synchronizedPayloadBySide);
      if (!updatedVersion) {
        return;
      }
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
        design_payload: sanitizePayloadBySideForSave(
          baseVersion
            ? normalizeDesignPayloadBySide(baseVersion.design_payload)
            : {
                front: createEmptyEditableDesignPayload(),
                back: createEmptyEditableDesignPayload(),
              }
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
    const shouldSaveBeforePublish = isDirty;
    if (
      shouldSaveBeforePublish &&
      !window.confirm(t("licenseCardDesignerPublishUnsavedChangesConfirm"))
    ) {
      return;
    }

    setIsPublishingDraft(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (shouldSaveBeforePublish) {
        const updatedVersion = await persistDraftPayload(selectedVersion.id, synchronizedPayloadBySide);
        if (!updatedVersion) {
          return;
        }
        setVersions((previousVersions) =>
          previousVersions.map((version) =>
            version.id === updatedVersion.id ? updatedVersion : version
          )
        );
      }
      // Manual regression check (DEF-7-001): edit a draft without saving, publish it,
      // then verify the published version includes the latest in-memory edits.
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

  const refreshAssetLibraries = useCallback(async () => {
    const [fontAssetResponse, imageAssetResponse] = await Promise.all([
      getCardFontAssets(),
      getCardImageAssets(),
    ]);
    setFontAssets(fontAssetResponse);
    setImageAssets(imageAssetResponse);
  }, []);

  const setSelectedFontAssetFile = useCallback((file: File | null) => {
    selectedFontAssetFileRef.current = file;
    setNewFontAssetFile(file);
  }, []);

  const setSelectedImageAssetFile = useCallback((file: File | null) => {
    selectedImageAssetFileRef.current = file;
    setNewImageAssetFile(file);
  }, []);

  const resetFontAssetInput = useCallback(() => {
    setSelectedFontAssetFile(null);
    if (fontAssetInputRef.current) {
      fontAssetInputRef.current.value = "";
    }
  }, [setSelectedFontAssetFile]);

  const resetImageAssetInput = useCallback(() => {
    setSelectedImageAssetFile(null);
    if (imageAssetInputRef.current) {
      imageAssetInputRef.current.value = "";
    }
  }, [setSelectedImageAssetFile]);

  const openFontAssetFilePicker = useCallback(() => {
    if (isUploadingFontAsset) {
      return;
    }
    const input = fontAssetInputRef.current;
    if (!input) {
      return;
    }
    setSelectedFontAssetFile(null);
    input.value = "";
    input.click();
  }, [isUploadingFontAsset, setSelectedFontAssetFile]);

  const openImageAssetFilePicker = useCallback(() => {
    if (isUploadingImageAsset) {
      return;
    }
    const input = imageAssetInputRef.current;
    if (!input) {
      return;
    }
    setSelectedImageAssetFile(null);
    input.value = "";
    input.click();
  }, [isUploadingImageAsset, setSelectedImageAssetFile]);

  const handleFontAssetFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;
      setSelectedFontAssetFile(file);
    },
    [setSelectedFontAssetFile]
  );

  const handleImageAssetFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;
      setSelectedImageAssetFile(file);
    },
    [setSelectedImageAssetFile]
  );

  const handleUploadFontAsset = useCallback(async () => {
    const selectedFile =
      newFontAssetFile ??
      selectedFontAssetFileRef.current ??
      fontAssetInputRef.current?.files?.[0] ??
      null;
    if (!selectedFile) {
      setErrorMessage(t("licenseCardAssetLibraryFontFileRequiredError"));
      return;
    }
    if (selectedFile !== newFontAssetFile) {
      setSelectedFontAssetFile(selectedFile);
    }
    const trimmedName = newFontAssetName.trim();
    const payload: CardFontAssetUploadInput = {
      name: trimmedName || selectedFile.name,
      file: selectedFile,
    };
    setIsUploadingFontAsset(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const uploadedAsset = await createCardFontAsset(payload);
      await refreshAssetLibraries();
      setNewFontAssetName("");
      resetFontAssetInput();
      setSuccessMessage(
        t("licenseCardAssetLibraryFontUploadSuccess", { name: uploadedAsset.name })
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardAssetLibraryFontUploadError")
      );
    } finally {
      setIsUploadingFontAsset(false);
    }
  }, [
    newFontAssetFile,
    newFontAssetName,
    refreshAssetLibraries,
    resetFontAssetInput,
    setSelectedFontAssetFile,
    t,
  ]);

  const handleUploadImageAsset = useCallback(async () => {
    const selectedFile =
      newImageAssetFile ??
      selectedImageAssetFileRef.current ??
      imageAssetInputRef.current?.files?.[0] ??
      null;
    if (!selectedFile) {
      setErrorMessage(t("licenseCardAssetLibraryImageFileRequiredError"));
      return;
    }
    if (selectedFile !== newImageAssetFile) {
      setSelectedImageAssetFile(selectedFile);
    }
    const trimmedName = newImageAssetName.trim();
    const payload: CardImageAssetUploadInput = {
      name: trimmedName || selectedFile.name,
      image: selectedFile,
    };
    setIsUploadingImageAsset(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const uploadedAsset = await createCardImageAsset(payload);
      await refreshAssetLibraries();
      setNewImageAssetName("");
      resetImageAssetInput();
      setSuccessMessage(
        t("licenseCardAssetLibraryImageUploadSuccess", { name: uploadedAsset.name })
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardAssetLibraryImageUploadError")
      );
    } finally {
      setIsUploadingImageAsset(false);
    }
  }, [
    newImageAssetFile,
    newImageAssetName,
    refreshAssetLibraries,
    resetImageAssetInput,
    setSelectedImageAssetFile,
    t,
  ]);

  const clearPreviewLookupSelections = () => {
    setPreviewSelectedMember(null);
    setPreviewSelectedLicense(null);
    setPreviewSelectedClub(null);
    setPreviewMemberLookupQuery("");
    setPreviewLicenseLookupQuery("");
    setPreviewClubLookupQuery("");
  };

  const resetPreviewControls = () => {
    clearPreviewLookupSelections();
    setIsAdvancedPreviewMode(false);
    setPreviewSampleDataInput("{}");
    setPreviewPaperProfileValue(TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE);
    setPreviewData(null);
    if (effectiveSlotCount > 0) {
      setPreviewSelectedSlots(Array.from({ length: effectiveSlotCount }, (_, index) => index));
    } else {
      setPreviewSelectedSlots([]);
    }
  };

  const buildPreviewSheetPayload = useCallback((): CardSheetPreviewRequestInput => {
    const payload: CardSheetPreviewRequestInput = {
      side: activeSide,
      include_bleed_guide: showBleedGuide,
      include_safe_area_guide: showSafeAreaGuide,
      bleed_mm: toMmString(bleedGuideMm),
      safe_area_mm: toMmString(safeAreaGuideMm),
    };
    if (previewSelectedMember) {
      payload.member_id = previewSelectedMember.id;
    }
    if (previewSelectedLicense) {
      payload.license_id = previewSelectedLicense.id;
    }
    if (previewSelectedClub) {
      payload.club_id = previewSelectedClub.id;
    }
    if (isAdvancedPreviewMode) {
      let sampleData: Record<string, unknown> = {};
      try {
        sampleData = parsePreviewSampleData(previewSampleDataInput);
      } catch {
        throw new Error(t("licenseCardPreviewInvalidSampleDataError"));
      }
      payload.sample_data = sampleData;
    }
    if (previewPaperProfileValue !== TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE) {
      const paperProfileId = Number(previewPaperProfileValue);
      if (Number.isFinite(paperProfileId)) {
        payload.paper_profile_id = paperProfileId;
      }
    }
    if (effectiveSlotCount > 0) {
      const normalized = normalizeSlotSelection(previewSelectedSlots, effectiveSlotCount);
      if (normalized.length > 0) {
        payload.selected_slots = normalized;
      }
    }
    return payload;
  }, [
    activeSide,
    bleedGuideMm,
    effectiveSlotCount,
    isAdvancedPreviewMode,
    previewPaperProfileValue,
    previewSelectedClub,
    previewSelectedLicense,
    previewSelectedMember,
    previewSampleDataInput,
    previewSelectedSlots,
    safeAreaGuideMm,
    showBleedGuide,
    showSafeAreaGuide,
    t,
  ]);

  const buildPreviewCardPayload = useCallback((): CardPreviewRequestInput => {
    const sheetPayload = buildPreviewSheetPayload();
    return {
      side: sheetPayload.side,
      member_id: sheetPayload.member_id,
      license_id: sheetPayload.license_id,
      club_id: sheetPayload.club_id,
      sample_data: sheetPayload.sample_data,
      include_bleed_guide: sheetPayload.include_bleed_guide,
      include_safe_area_guide: sheetPayload.include_safe_area_guide,
      bleed_mm: sheetPayload.bleed_mm,
      safe_area_mm: sheetPayload.safe_area_mm,
    };
  }, [buildPreviewSheetPayload]);

  const handleRefreshPreviewData = async () => {
    if (!selectedVersion) {
      setErrorMessage(t("licenseCardDesignerNoVersionsSubtitle"));
      return;
    }

    setIsLoadingPreviewData(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload = buildPreviewSheetPayload();
      const response = await getCardTemplateVersionPreviewData(selectedVersion.id, payload);
      setPreviewData(response);
      if (Array.isArray(response.selected_slots)) {
        setPreviewSelectedSlots(response.selected_slots);
      }
      setSuccessMessage(t("licenseCardPreviewDataLoadedSuccess"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPreviewDataLoadError")
      );
    } finally {
      setIsLoadingPreviewData(false);
    }
  };

  const handleOpenCardPreviewPdf = async () => {
    if (!selectedVersion) {
      setErrorMessage(t("licenseCardDesignerNoVersionsSubtitle"));
      return;
    }

    setIsOpeningCardPreviewPdf(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload = buildPreviewCardPayload();
      const blob = await getCardTemplateVersionCardPreviewPdf(selectedVersion.id, payload);
      openBlobInNewTab(blob);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPreviewCardPdfError")
      );
    } finally {
      setIsOpeningCardPreviewPdf(false);
    }
  };

  const handleOpenSheetPreviewPdf = async () => {
    if (!selectedVersion) {
      setErrorMessage(t("licenseCardDesignerNoVersionsSubtitle"));
      return;
    }
    if (!effectivePreviewPaperProfile && previewPaperProfileValue === TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE) {
      setErrorMessage(t("licenseCardPreviewSheetRequiresPaperProfileError"));
      return;
    }

    setIsOpeningSheetPreviewPdf(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload = buildPreviewSheetPayload();
      if (!payload.paper_profile_id && !selectedVersion.paper_profile) {
        setErrorMessage(t("licenseCardPreviewSheetRequiresPaperProfileError"));
        return;
      }
      const blob = await getCardTemplateVersionSheetPreviewPdf(selectedVersion.id, payload);
      openBlobInNewTab(blob);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("licenseCardPreviewSheetPdfError")
      );
    } finally {
      setIsOpeningSheetPreviewPdf(false);
    }
  };

  const handleRefreshLiveSimulation = useCallback(async () => {
    if (!selectedVersion) {
      setLiveSimulationError(t("licenseCardDesignerNoVersionsSubtitle"));
      return;
    }
    setIsLoadingLiveSimulation(true);
    setLiveSimulationError(null);
    try {
      const payload = buildPreviewCardPayload();
      const response = await getCardTemplateVersionCardPreviewHtml(selectedVersion.id, payload);
      setLiveSimulationData(response);
    } catch (error) {
      setLiveSimulationData(null);
      setLiveSimulationError(
        error instanceof Error ? error.message : t("licenseCardPreviewSimulationLoadError")
      );
    } finally {
      setIsLoadingLiveSimulation(false);
    }
  }, [buildPreviewCardPayload, selectedVersion, t]);

  useEffect(() => {
    if (!isLivePrintSimulationEnabled) {
      return;
    }
    void handleRefreshLiveSimulation();
  }, [activeSide, handleRefreshLiveSimulation, isLivePrintSimulationEnabled, selectedVersion?.id]);

  const togglePreviewSlot = (slotIndex: number) => {
    if (effectiveSlotCount <= 0) {
      return;
    }
    setPreviewSelectedSlots((previousSlots) => {
      const selectedSet = new Set(normalizeSlotSelection(previousSlots, effectiveSlotCount));
      if (selectedSet.has(slotIndex)) {
        selectedSet.delete(slotIndex);
      } else {
        selectedSet.add(slotIndex);
      }
      return normalizeSlotSelection(Array.from(selectedSet.values()), effectiveSlotCount);
    });
  };

  const alignSelectedElements = useCallback(
    (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
      if (!isEditableDraft || selectedElements.length < 2) {
        return;
      }
      const selectedSet = new Set(effectiveSelectedElementIds);
      const selectionBounds = getBoundsForElements(selectedElements);
      if (!selectionBounds) {
        return;
      }
      applyDesignMutation((previousPayload) => ({
        ...previousPayload,
        elements: previousPayload.elements.map((element) => {
          if (!selectedSet.has(element.id)) {
            return element;
          }
          if (mode === "left") {
            return clampElementToCanvas(
              { ...element, x_mm: selectionBounds.left },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          if (mode === "center") {
            return clampElementToCanvas(
              {
                ...element,
                x_mm: selectionBounds.centerX - element.width_mm / 2,
              },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          if (mode === "right") {
            return clampElementToCanvas(
              {
                ...element,
                x_mm: selectionBounds.right - element.width_mm,
              },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          if (mode === "top") {
            return clampElementToCanvas(
              { ...element, y_mm: selectionBounds.top },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          if (mode === "middle") {
            return clampElementToCanvas(
              {
                ...element,
                y_mm: selectionBounds.centerY - element.height_mm / 2,
              },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          return clampElementToCanvas(
            {
              ...element,
              y_mm: selectionBounds.bottom - element.height_mm,
            },
            canvasWidthMm,
            canvasHeightMm
          );
        }),
      }));
    },
    [
      applyDesignMutation,
      canvasHeightMm,
      canvasWidthMm,
      effectiveSelectedElementIds,
      isEditableDraft,
      selectedElements,
    ]
  );

  const distributeSelectedElements = useCallback(
    (axis: "horizontal" | "vertical") => {
      if (!isEditableDraft || selectedElements.length < 3) {
        return;
      }
      const sorted = [...selectedElements].sort((a, b) =>
        axis === "horizontal" ? a.x_mm - b.x_mm : a.y_mm - b.y_mm
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) {
        return;
      }
      const totalSize = sorted.reduce((sum, element) => {
        return sum + (axis === "horizontal" ? element.width_mm : element.height_mm);
      }, 0);
      const rangeStart = axis === "horizontal" ? first.x_mm : first.y_mm;
      const rangeEnd =
        axis === "horizontal" ? last.x_mm + last.width_mm : last.y_mm + last.height_mm;
      const availableGap = rangeEnd - rangeStart - totalSize;
      if (!Number.isFinite(availableGap)) {
        return;
      }
      const gap = availableGap / Math.max(sorted.length - 1, 1);
      const nextPositionById = new Map<string, number>();
      let cursor = rangeStart;
      for (const element of sorted) {
        nextPositionById.set(element.id, cursor);
        cursor += (axis === "horizontal" ? element.width_mm : element.height_mm) + gap;
      }
      const selectedSet = new Set(effectiveSelectedElementIds);
      applyDesignMutation((previousPayload) => ({
        ...previousPayload,
        elements: previousPayload.elements.map((element) => {
          if (!selectedSet.has(element.id)) {
            return element;
          }
          const nextPosition = nextPositionById.get(element.id);
          if (!Number.isFinite(nextPosition)) {
            return element;
          }
          if (axis === "horizontal") {
            return clampElementToCanvas(
              {
                ...element,
                x_mm: Number(nextPosition),
              },
              canvasWidthMm,
              canvasHeightMm
            );
          }
          return clampElementToCanvas(
            {
              ...element,
              y_mm: Number(nextPosition),
            },
            canvasWidthMm,
            canvasHeightMm
          );
        }),
      }));
    },
    [
      applyDesignMutation,
      canvasHeightMm,
      canvasWidthMm,
      effectiveSelectedElementIds,
      isEditableDraft,
      selectedElements,
    ]
  );

  const groupSelectedElements = useCallback(() => {
    if (!isEditableDraft || effectiveSelectedElementIds.length < 2) {
      return;
    }
    const groupId = createGroupId();
    const selectedSet = new Set(effectiveSelectedElementIds);
    applyDesignMutation((previousPayload) => ({
      ...previousPayload,
      elements: previousPayload.elements.map((element) =>
        selectedSet.has(element.id) ? withGroupId(element, groupId) : element
      ),
    }));
  }, [applyDesignMutation, effectiveSelectedElementIds, isEditableDraft]);

  const ungroupSelectedElements = useCallback(() => {
    if (!isEditableDraft || effectiveSelectedElementIds.length === 0) {
      return;
    }
    const selectedSet = new Set(effectiveSelectedElementIds);
    applyDesignMutation((previousPayload) => ({
      ...previousPayload,
      elements: previousPayload.elements.map((element) =>
        selectedSet.has(element.id) ? withGroupId(element, null) : element
      ),
    }));
  }, [applyDesignMutation, effectiveSelectedElementIds, isEditableDraft]);

  const duplicateSelectedElements = useCallback(() => {
    if (!isEditableDraft || effectiveSelectedElementIds.length === 0) {
      return;
    }
    const selectedSet = new Set(effectiveSelectedElementIds);
    const groupRemap = new Map<string, string>();
    const duplicatedIds: string[] = [];
    applyDesignMutation((previousPayload) => {
      const duplicated = previousPayload.elements
        .filter((element) => selectedSet.has(element.id))
        .map((element) => {
          const currentGroupId = getElementGroupId(element);
          let nextGroupId: string | null = null;
          if (currentGroupId) {
            nextGroupId = groupRemap.get(currentGroupId) ?? createGroupId();
            groupRemap.set(currentGroupId, nextGroupId);
          }
          const duplicatedElement = clampElementToCanvas(
            withGroupId(
              {
                ...element,
                id: generateElementId(),
                x_mm: element.x_mm + 2,
                y_mm: element.y_mm + 2,
              },
              nextGroupId
            ),
            canvasWidthMm,
            canvasHeightMm
          );
          duplicatedIds.push(duplicatedElement.id);
          return duplicatedElement;
        });
      return {
        ...previousPayload,
        elements: [...previousPayload.elements, ...duplicated],
      };
    });
    if (duplicatedIds.length > 0) {
      setSelectedElementIds(duplicatedIds);
      setSelectedElementId(duplicatedIds[duplicatedIds.length - 1] ?? null);
    }
  }, [
    applyDesignMutation,
    canvasHeightMm,
    canvasWidthMm,
    effectiveSelectedElementIds,
    isEditableDraft,
  ]);

  const nudgeSelectedElements = useCallback(
    (deltaX_mm: number, deltaY_mm: number) => {
      if (!isEditableDraft || effectiveSelectedElementIds.length === 0) {
        return;
      }
      const selectedSet = new Set(effectiveSelectedElementIds);
      applyDesignMutation((previousPayload) => ({
        ...previousPayload,
        elements: previousPayload.elements.map((element) => {
          if (!selectedSet.has(element.id)) {
            return element;
          }
          return clampElementToCanvas(
            {
              ...element,
              x_mm: element.x_mm + deltaX_mm,
              y_mm: element.y_mm + deltaY_mm,
            },
            canvasWidthMm,
            canvasHeightMm
          );
        }),
      }));
    },
    [applyDesignMutation, canvasHeightMm, canvasWidthMm, effectiveSelectedElementIds, isEditableDraft]
  );

  const moveSelectedLayers = useCallback(
    (direction: "forward" | "backward") => {
      if (!isEditableDraft || effectiveSelectedElementIds.length === 0) {
        return;
      }
      const selectedSet = new Set(effectiveSelectedElementIds);
      applyDesignMutation((previousPayload) => {
        const nextElements = [...previousPayload.elements];
        if (direction === "forward") {
          for (let index = nextElements.length - 2; index >= 0; index -= 1) {
            if (selectedSet.has(nextElements[index].id) && !selectedSet.has(nextElements[index + 1].id)) {
              [nextElements[index], nextElements[index + 1]] = [
                nextElements[index + 1],
                nextElements[index],
              ];
            }
          }
        } else {
          for (let index = 1; index < nextElements.length; index += 1) {
            if (selectedSet.has(nextElements[index].id) && !selectedSet.has(nextElements[index - 1].id)) {
              [nextElements[index], nextElements[index - 1]] = [
                nextElements[index - 1],
                nextElements[index],
              ];
            }
          }
        }
        return {
          ...previousPayload,
          elements: nextElements,
        };
      });
    },
    [applyDesignMutation, effectiveSelectedElementIds, isEditableDraft]
  );

  const moveSingleLayer = useCallback(
    (elementId: string, direction: "forward" | "backward") => {
      if (!isEditableDraft) {
        return;
      }
      applyDesignMutation((previousPayload) => {
        const nextElements = [...previousPayload.elements];
        const currentIndex = nextElements.findIndex((element) => element.id === elementId);
        if (currentIndex < 0) {
          return previousPayload;
        }
        const targetIndex =
          direction === "forward" ? Math.min(nextElements.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
        if (targetIndex === currentIndex) {
          return previousPayload;
        }
        const [movedElement] = nextElements.splice(currentIndex, 1);
        nextElements.splice(targetIndex, 0, movedElement);
        return {
          ...previousPayload,
          elements: nextElements,
        };
      });
    },
    [applyDesignMutation, isEditableDraft]
  );

  const reorderLayersByDrag = useCallback(
    (sourceId: string, targetId: string) => {
      if (!isEditableDraft || sourceId === targetId) {
        return;
      }
      applyDesignMutation((previousPayload) => {
        const topOrdered = [...previousPayload.elements].reverse();
        const sourceIndex = topOrdered.findIndex((element) => element.id === sourceId);
        const targetIndex = topOrdered.findIndex((element) => element.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
          return previousPayload;
        }
        const nextTopOrdered = [...topOrdered];
        const [movedElement] = nextTopOrdered.splice(sourceIndex, 1);
        nextTopOrdered.splice(targetIndex, 0, movedElement);
        return {
          ...previousPayload,
          elements: [...nextTopOrdered].reverse(),
        };
      });
    },
    [applyDesignMutation, isEditableDraft]
  );

  const handleUndo = useCallback(() => {
    if (historyPastRef.current.length === 0) {
      return;
    }
    const previousPayload = historyPastRef.current.pop();
    if (!previousPayload) {
      return;
    }
    historyFutureRef.current.push(cloneEditableDesignPayload(designPayload));
    setDesignPayload(cloneEditableDesignPayload(previousPayload));
    const previousIds = new Set(previousPayload.elements.map((element) => element.id));
    const nextSelectedIds = effectiveSelectedElementIds.filter((id) => previousIds.has(id));
    setSelectedElementIds(nextSelectedIds);
    setSelectedElementId(nextSelectedIds[nextSelectedIds.length - 1] ?? null);
    setDragState(null);
    setResizeState(null);
    setSnapGuideLines([]);
    setLiveMeasurementBounds(null);
    setHistoryRevision((value) => value + 1);
  }, [designPayload, effectiveSelectedElementIds]);

  const handleRedo = useCallback(() => {
    if (historyFutureRef.current.length === 0) {
      return;
    }
    const nextPayload = historyFutureRef.current.pop();
    if (!nextPayload) {
      return;
    }
    historyPastRef.current.push(cloneEditableDesignPayload(designPayload));
    if (historyPastRef.current.length > HISTORY_STACK_LIMIT) {
      historyPastRef.current.shift();
    }
    setDesignPayload(cloneEditableDesignPayload(nextPayload));
    const nextIds = new Set(nextPayload.elements.map((element) => element.id));
    const nextSelectedIds = effectiveSelectedElementIds.filter((id) => nextIds.has(id));
    setSelectedElementIds(nextSelectedIds);
    setSelectedElementId(nextSelectedIds[nextSelectedIds.length - 1] ?? null);
    setDragState(null);
    setResizeState(null);
    setSnapGuideLines([]);
    setLiveMeasurementBounds(null);
    setHistoryRevision((value) => value + 1);
  }, [designPayload, effectiveSelectedElementIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isEditableDraft || isEventFromEditableField(event.target)) {
        return;
      }
      const commandPressed = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (commandPressed && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (commandPressed && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (commandPressed && key === "d") {
        event.preventDefault();
        duplicateSelectedElements();
        return;
      }
      if (commandPressed && key === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          ungroupSelectedElements();
        } else {
          groupSelectedElements();
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelectedElement();
        return;
      }
      const nudgeStep = event.shiftKey ? 2 : 0.5;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeSelectedElements(0, -nudgeStep);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeSelectedElements(0, nudgeStep);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSelectedElements(-nudgeStep, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSelectedElements(nudgeStep, 0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    duplicateSelectedElements,
    groupSelectedElements,
    handleRedo,
    handleUndo,
    isEditableDraft,
    nudgeSelectedElements,
    removeSelectedElement,
    ungroupSelectedElements,
  ]);

  const layersTopToBottom = useMemo(() => {
    return [...designPayload.elements].reverse();
  }, [designPayload.elements]);

  const toolLabelByType = {
    text: t("licenseCardDesignerToolText"),
    image: t("licenseCardDesignerToolImage"),
    shape: t("licenseCardDesignerToolShape"),
    qr: t("licenseCardDesignerToolQr"),
    barcode: t("licenseCardDesignerToolBarcode"),
  } satisfies Record<CardElementType, string>;
  const selectedCount = effectiveSelectedElementIds.length;
  const rulerMarksX = useMemo(
    () => Array.from({ length: Math.floor(canvasWidthMm) + 1 }, (_, index) => index),
    [canvasWidthMm]
  );
  const rulerMarksY = useMemo(
    () => Array.from({ length: Math.floor(canvasHeightMm) + 1 }, (_, index) => index),
    [canvasHeightMm]
  );
  const sheetGeometrySourceLabel = sheetGeometryProfile
    ? sheetGeometryProfile.source === "preview-data"
      ? t("licenseCardPreviewSheetGeometrySourceBackend")
      : t("licenseCardPreviewSheetGeometrySourceFallback")
    : null;
  const sheetGeometryFormulaX = sheetGeometryProfile
    ? `x = ${toMmString(sheetGeometryProfile.margin_left_mm)} + col * (${toMmString(
        sheetGeometryProfile.card_width_mm
      )} + ${toMmString(sheetGeometryProfile.horizontal_gap_mm)})`
    : "";
  const sheetGeometryFormulaY = sheetGeometryProfile
    ? `y = ${toMmString(sheetGeometryProfile.margin_top_mm)} + row * (${toMmString(
        sheetGeometryProfile.card_height_mm
      )} + ${toMmString(sheetGeometryProfile.vertical_gap_mm)})`
    : "";
  const sheetGeometryParityPreview = sheetGeometryParityIssues.slice(0, 6);

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

      <section className="mb-4 space-y-3 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            {t("licenseCardDesignerSidesTitle")}
          </h2>
          <p className="text-xs text-zinc-500">
            {t("licenseCardDesignerActiveSideSummary", {
              side: activeSideLabel,
              count: localSideSummary[activeSide].element_count,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={activeSide === "front" ? "default" : "outline"}
            onClick={() => switchActiveSide("front")}
          >
            {sideLabelByValue.front}
          </Button>
          <Button
            size="sm"
            variant={activeSide === "back" ? "default" : "outline"}
            onClick={() => switchActiveSide("back")}
          >
            {sideLabelByValue.back}
          </Button>
          <Button size="sm" variant="outline" onClick={flipActiveSide}>
            {t("licenseCardDesignerFlipSideAction")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!isEditableDraft}
            onClick={() => copySidePayload("front", "back")}
          >
            {t("licenseCardDesignerCopyFrontToBackAction")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!isEditableDraft}
            onClick={() => copySidePayload("back", "front")}
          >
            {t("licenseCardDesignerCopyBackToFrontAction")}
          </Button>
        </div>
      </section>

      <section className="mb-4 space-y-3 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">{t("licenseCardEditorToolsTitle")}</h2>
          <p className="text-xs text-zinc-500">
            {t("licenseCardEditorSelectionCountLabel", { count: selectedCount })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canUndo}
            onClick={handleUndo}
          >
            {t("licenseCardEditorUndoAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canRedo}
            onClick={handleRedo}
          >
            {t("licenseCardEditorRedoAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("left")}
          >
            {t("licenseCardEditorAlignLeftAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("center")}
          >
            {t("licenseCardEditorAlignCenterAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("right")}
          >
            {t("licenseCardEditorAlignRightAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("top")}
          >
            {t("licenseCardEditorAlignTopAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("middle")}
          >
            {t("licenseCardEditorAlignMiddleAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={() => alignSelectedElements("bottom")}
          >
            {t("licenseCardEditorAlignBottomAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 3}
            onClick={() => distributeSelectedElements("horizontal")}
          >
            {t("licenseCardEditorDistributeHorizontalAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 3}
            onClick={() => distributeSelectedElements("vertical")}
          >
            {t("licenseCardEditorDistributeVerticalAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount < 2}
            onClick={groupSelectedElements}
          >
            {t("licenseCardEditorGroupAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount === 0}
            onClick={ungroupSelectedElements}
          >
            {t("licenseCardEditorUngroupAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount === 0}
            onClick={() => moveSelectedLayers("forward")}
          >
            {t("licenseCardEditorBringForwardAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount === 0}
            onClick={() => moveSelectedLayers("backward")}
          >
            {t("licenseCardEditorSendBackwardAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isEditableDraft || selectedCount === 0}
            onClick={duplicateSelectedElements}
          >
            {t("licenseCardEditorDuplicateAction")}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={showRulers}
              onCheckedChange={(checked) => setShowRulers(Boolean(checked))}
            />
            {t("licenseCardEditorShowRulersToggle")}
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={showGrid}
              onCheckedChange={(checked) => setShowGrid(Boolean(checked))}
            />
            {t("licenseCardEditorShowGridToggle")}
          </label>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-zinc-500">
              {t("licenseCardEditorGridSizeLabel")}
            </label>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={gridSizeMmInput}
              onChange={(event) => setGridSizeMmInput(event.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={snapToGrid}
              onCheckedChange={(checked) => setSnapToGrid(Boolean(checked))}
            />
            {t("licenseCardEditorSnapToGridToggle")}
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={snapToElements}
              onCheckedChange={(checked) => setSnapToElements(Boolean(checked))}
            />
            {t("licenseCardEditorSnapToElementsToggle")}
          </label>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-zinc-500">
              {t("licenseCardEditorSnapThresholdLabel")}
            </label>
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={snapThresholdMmInput}
              onChange={(event) => setSnapThresholdMmInput(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="mb-4 space-y-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            {t("licenseCardPreviewControlsTitle")}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">{t("licenseCardPreviewControlsSubtitle")}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {t("licenseCardPreviewActiveSideLabel", {
              side: activeSideLabel,
              available: previewAvailableSides.map((side) => sideLabelByValue[side]).join(", "),
            })}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DesignerLookupField
            label={t("licenseCardPreviewMemberLookupLabel")}
            searchPlaceholder={t("licenseCardPreviewMemberLookupSearchPlaceholder")}
            selectedPlaceholder={t("licenseCardPreviewLookupSelectedPlaceholder")}
            loadingLabel={t("licenseCardPreviewLookupLoading")}
            noResultsLabel={t("licenseCardPreviewLookupNoResults")}
            clearActionLabel={t("licenseCardPreviewLookupClearAction")}
            query={previewMemberLookupQuery}
            selectedItem={previewSelectedMember}
            options={previewMemberLookupOptions}
            isLoading={isLoadingMemberLookup}
            onQueryChange={setPreviewMemberLookupQuery}
            onSelect={(item) => {
              setPreviewSelectedMember(item);
              setPreviewMemberLookupQuery(item.label);
            }}
            onClear={() => {
              setPreviewSelectedMember(null);
              setPreviewMemberLookupQuery("");
            }}
          />
          <DesignerLookupField
            label={t("licenseCardPreviewLicenseLookupLabel")}
            searchPlaceholder={t("licenseCardPreviewLicenseLookupSearchPlaceholder")}
            selectedPlaceholder={t("licenseCardPreviewLookupSelectedPlaceholder")}
            loadingLabel={t("licenseCardPreviewLookupLoading")}
            noResultsLabel={t("licenseCardPreviewLookupNoResults")}
            clearActionLabel={t("licenseCardPreviewLookupClearAction")}
            query={previewLicenseLookupQuery}
            selectedItem={previewSelectedLicense}
            options={previewLicenseLookupOptions}
            isLoading={isLoadingLicenseLookup}
            onQueryChange={setPreviewLicenseLookupQuery}
            onSelect={(item) => {
              setPreviewSelectedLicense(item);
              setPreviewLicenseLookupQuery(item.label);
            }}
            onClear={() => {
              setPreviewSelectedLicense(null);
              setPreviewLicenseLookupQuery("");
            }}
          />
          <DesignerLookupField
            label={t("licenseCardPreviewClubLookupLabel")}
            searchPlaceholder={t("licenseCardPreviewClubLookupSearchPlaceholder")}
            selectedPlaceholder={t("licenseCardPreviewLookupSelectedPlaceholder")}
            loadingLabel={t("licenseCardPreviewLookupLoading")}
            noResultsLabel={t("licenseCardPreviewLookupNoResults")}
            clearActionLabel={t("licenseCardPreviewLookupClearAction")}
            query={previewClubLookupQuery}
            selectedItem={previewSelectedClub}
            options={previewClubLookupOptions}
            isLoading={isLoadingClubLookup}
            onQueryChange={setPreviewClubLookupQuery}
            onSelect={(item) => {
              setPreviewSelectedClub(item);
              setPreviewClubLookupQuery(item.label);
            }}
            onClear={() => {
              setPreviewSelectedClub(null);
              setPreviewClubLookupQuery("");
            }}
          />
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-zinc-500">
              {t("licenseCardPreviewPaperProfileOverrideLabel")}
            </label>
            <Select value={previewPaperProfileValue} onValueChange={setPreviewPaperProfileValue}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={t("licenseCardPreviewPaperProfileTemplateDefaultOption")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TEMPLATE_DEFAULT_PAPER_PROFILE_VALUE}>
                  {t("licenseCardPreviewPaperProfileTemplateDefaultOption")}
                </SelectItem>
                {paperProfilesForSelectedCardFormat.map((paperProfile) => (
                  <SelectItem key={paperProfile.id} value={String(paperProfile.id)}>
                    {paperProfile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-zinc-500">{t("licenseCardPreviewPaperProfileHint")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={clearPreviewLookupSelections}>
            {t("licenseCardPreviewClearLookupSelectionsAction")}
          </Button>
          <Button size="sm" variant="ghost" onClick={resetPreviewControls}>
            {t("licenseCardPreviewResetControlsAction")}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={showBleedGuide}
              onCheckedChange={(checked) => setShowBleedGuide(Boolean(checked))}
            />
            {t("licenseCardDesignerBleedGuideToggle")}
          </label>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-zinc-500">
              {t("licenseCardPreviewBleedValueLabel")}
            </label>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={bleedGuideMmInput}
              onChange={(event) => setBleedGuideMmInput(event.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
            <Checkbox
              checked={showSafeAreaGuide}
              onCheckedChange={(checked) => setShowSafeAreaGuide(Boolean(checked))}
            />
            {t("licenseCardDesignerSafeAreaGuideToggle")}
          </label>
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-zinc-500">
              {t("licenseCardPreviewSafeAreaValueLabel")}
            </label>
            <Input
              type="number"
              min="0"
              step="0.1"
              value={safeAreaGuideMmInput}
              onChange={(event) => setSafeAreaGuideMmInput(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700">
            <Checkbox
              checked={isAdvancedPreviewMode}
              onCheckedChange={(checked) => setIsAdvancedPreviewMode(Boolean(checked))}
            />
            {t("licenseCardPreviewAdvancedModeToggleLabel")}
          </label>
          <p className="text-xs text-zinc-500">{t("licenseCardPreviewAdvancedModeHint")}</p>
          {isAdvancedPreviewMode ? (
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase text-zinc-500">
                {t("licenseCardPreviewSampleDataLabel")}
              </label>
              <textarea
                className="min-h-[132px] w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-zinc-500"
                value={previewSampleDataInput}
                placeholder={t("licenseCardPreviewSampleDataPlaceholder")}
                onChange={(event) => setPreviewSampleDataInput(event.target.value)}
              />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">{t("licenseCardPreviewSampleDataHiddenHint")}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!selectedVersion || isLoadingPreviewData}
              onClick={() => void handleRefreshPreviewData()}
            >
              {isLoadingPreviewData
                ? t("licenseCardPreviewRefreshingDataAction")
                : t("licenseCardPreviewRefreshDataAction")}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedVersion || isOpeningCardPreviewPdf}
              onClick={() => void handleOpenCardPreviewPdf()}
            >
              {isOpeningCardPreviewPdf
                ? t("licenseCardPreviewOpeningCardPdfAction")
                : t("licenseCardPreviewOpenCardPdfAction")}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedVersion || isOpeningSheetPreviewPdf}
              onClick={() => void handleOpenSheetPreviewPdf()}
            >
              {isOpeningSheetPreviewPdf
                ? t("licenseCardPreviewOpeningSheetPdfAction")
                : t("licenseCardPreviewOpenSheetPdfAction")}
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">
              {t("licenseCardPreviewSlotSelectorTitle")}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={effectiveSlotCount <= 0}
                onClick={() =>
                  setPreviewSelectedSlots(Array.from({ length: effectiveSlotCount }, (_, i) => i))
                }
              >
                {t("licenseCardPreviewSelectAllSlotsAction")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={effectiveSlotCount <= 0}
                onClick={() => setPreviewSelectedSlots([])}
              >
                {t("licenseCardPreviewClearSlotsAction")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">{t("licenseCardPreviewSlotSelectorSubtitle")}</p>
          {effectiveSlotCount <= 0 ? (
            <p className="text-xs text-zinc-500">{t("licenseCardPreviewNoSlotsAvailable")}</p>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, slotGridColumns)}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: effectiveSlotCount }, (_, index) => {
                const selected = previewSelectedSlots.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    className={`rounded-lg border px-2 py-2 text-xs transition ${
                      selected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                    onClick={() => togglePreviewSlot(index)}
                  >
                    {t("licenseCardPreviewSlotLabel", { index })}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mb-4 space-y-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{t("licenseCardPreviewDataTitle")}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t("licenseCardPreviewDataSubtitle")}</p>
        </div>
        {!previewData ? (
          <p className="text-sm text-zinc-500">{t("licenseCardPreviewNoData")}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-600">
                {t("licenseCardPreviewSideMetadataLabel", {
                  active: sideLabelByValue[(previewData.active_side || activeSide) as CardSide],
                  available: (previewData.available_sides || CARD_SIDES)
                    .map((side) => sideLabelByValue[side as CardSide])
                    .join(", "),
                  front: previewData.side_summary?.front?.element_count ?? localSideSummary.front.element_count,
                  back: previewData.side_summary?.back?.element_count ?? localSideSummary.back.element_count,
                })}
              </p>
            </div>
            {sheetGeometryProfile ? (
              <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {t("licenseCardPreviewSheetGeometryTitle")}
                  </h3>
                  <span className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                    {t("licenseCardPreviewSheetGeometrySourceLabel", {
                      source: sheetGeometrySourceLabel || "-",
                    })}
                  </span>
                </div>
                <p className="text-xs text-zinc-600">
                  {t("licenseCardPreviewSheetGeometryBoundsLabel", {
                    sheetWidth: toMmString(sheetLayoutMetadata?.sheet_width_mm || 0),
                    sheetHeight: toMmString(sheetLayoutMetadata?.sheet_height_mm || 0),
                    maxX: toMmString(sheetLayoutMetadata?.max_x_mm || 0),
                    maxY: toMmString(sheetLayoutMetadata?.max_y_mm || 0),
                  })}
                </p>
                <div className="space-y-1 rounded-md border border-zinc-200 bg-white px-2 py-2">
                  <p className="font-mono text-[11px] text-zinc-700">{sheetGeometryFormulaX}</p>
                  <p className="font-mono text-[11px] text-zinc-700">{sheetGeometryFormulaY}</p>
                </div>
                <p
                  className={`text-xs ${
                    sheetGeometryParityIssues.length === 0 ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {sheetGeometryParityIssues.length === 0
                    ? t("licenseCardPreviewSheetGeometryParityOk")
                    : t("licenseCardPreviewSheetGeometryParityMismatch", {
                        count: sheetGeometryParityIssues.length,
                      })}
                </p>
                <div className="overflow-auto rounded-xl border border-zinc-200 bg-white p-3">
                  <div
                    className="relative mx-auto"
                    style={{
                      width: sheetPreviewWidthPx + RULER_SIZE_PX,
                      height: sheetPreviewHeightPx + RULER_SIZE_PX,
                    }}
                  >
                    <div
                      className="pointer-events-none absolute left-0 top-0 border-b border-r border-zinc-300 bg-zinc-100"
                      style={{ width: RULER_SIZE_PX, height: RULER_SIZE_PX }}
                    />
                    <div
                      className="pointer-events-none absolute top-0 border-b border-zinc-300 bg-zinc-100"
                      style={{
                        left: RULER_SIZE_PX,
                        width: sheetPreviewWidthPx,
                        height: RULER_SIZE_PX,
                      }}
                    >
                      {sheetRulerMarksX.map((mark) => (
                        <div
                          key={`sheet-ruler-x-${mark}`}
                          className="absolute bottom-0"
                          style={{ left: mark * sheetPreviewScale }}
                        >
                          <div className="h-2 w-px bg-zinc-500" />
                          <span className="absolute -top-4 left-1 text-[9px] text-zinc-500">
                            {mark}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="pointer-events-none absolute left-0 border-r border-zinc-300 bg-zinc-100"
                      style={{
                        top: RULER_SIZE_PX,
                        width: RULER_SIZE_PX,
                        height: sheetPreviewHeightPx,
                      }}
                    >
                      {sheetRulerMarksY.map((mark) => (
                        <div
                          key={`sheet-ruler-y-${mark}`}
                          className="absolute right-0"
                          style={{ top: mark * sheetPreviewScale }}
                        >
                          <div className="h-px w-2 bg-zinc-500" />
                          <span className="absolute -left-6 -top-1 text-[9px] text-zinc-500">
                            {mark}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="relative border border-zinc-300 bg-zinc-50"
                      style={{
                        width: sheetPreviewWidthPx,
                        height: sheetPreviewHeightPx,
                        marginLeft: RULER_SIZE_PX,
                        marginTop: RULER_SIZE_PX,
                      }}
                    >
                      {sheetPreviewSlots.map((slot) => {
                        const slotLeftPx = slot.x_mm * sheetPreviewScale;
                        const slotTopPx = slot.y_mm * sheetPreviewScale;
                        const slotWidthPx = slot.width_mm * sheetPreviewScale;
                        const slotHeightPx = slot.height_mm * sheetPreviewScale;
                        const slotBleedPx = Math.max(0, bleedGuideMm * sheetPreviewScale);
                        const slotSafeAreaPx = Math.max(0, safeAreaGuideMm * sheetPreviewScale);
                        return (
                          <div
                            key={`sheet-slot-${slot.slot_index}`}
                            className="absolute overflow-hidden"
                            style={{
                              left: slotLeftPx,
                              top: slotTopPx,
                              width: slotWidthPx,
                              height: slotHeightPx,
                              borderRadius: slot.card_corner_radius_mm * sheetPreviewScale,
                              border: `1px dashed ${slot.selected ? "#2563eb" : "#94a3b8"}`,
                              backgroundColor: slot.selected
                                ? "rgba(37, 99, 235, 0.12)"
                                : "rgba(148, 163, 184, 0.10)",
                            }}
                          >
                            {slot.selected && showBleedGuide ? (
                              <div
                                className="pointer-events-none absolute inset-0"
                                style={{
                                  boxShadow: `inset 0 0 0 ${slotBleedPx}px rgba(244, 63, 94, 0.20)`,
                                }}
                              />
                            ) : null}
                            {slot.selected && showSafeAreaGuide ? (
                              <div
                                className="pointer-events-none absolute border border-dashed border-emerald-600/80"
                                style={{
                                  left: slotSafeAreaPx,
                                  top: slotSafeAreaPx,
                                  width: Math.max(slotWidthPx - slotSafeAreaPx * 2, 0),
                                  height: Math.max(slotHeightPx - slotSafeAreaPx * 2, 0),
                                }}
                              />
                            ) : null}
                            <div className="pointer-events-none absolute left-1 top-1 rounded bg-white/90 px-1 py-0.5 font-mono text-[9px] text-zinc-700">
                              #{slot.slot_index}
                            </div>
                            <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-white/90 px-1 py-0.5 font-mono text-[9px] text-zinc-600">
                              x:{toMmString(slot.x_mm)} y:{toMmString(slot.y_mm)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {sheetGeometryParityPreview.length > 0 ? (
                  <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-700">
                    {sheetGeometryParityPreview.map((issue, issueIndex) => (
                      <p key={`sheet-geometry-issue-${issueIndex}`}>
                        {t("licenseCardPreviewSheetGeometryParityIssueLabel", {
                          slot: issue.slot_index >= 0 ? String(issue.slot_index) : "-",
                          field: issue.field,
                          expected: toMmString(issue.expected),
                          actual: toMmString(issue.actual),
                        })}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                {t("licenseCardPreviewSheetGeometryNoProfile")}
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {t("licenseCardPreviewContextTitle")}
              </h3>
              <div className="max-h-72 space-y-1 overflow-auto">
                {Object.entries(previewData.context).length === 0 ? (
                  <p className="text-xs text-zinc-500">-</p>
                ) : (
                  Object.entries(previewData.context).map(([key, value]) => (
                    <div key={key} className="rounded-md border border-zinc-200 bg-white px-2 py-1">
                      <p className="font-mono text-[11px] text-zinc-700">{key}</p>
                      <p className="text-xs text-zinc-900">{value || "-"}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
              <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {t("licenseCardPreviewElementsTitle")}
              </h3>
              <div className="max-h-72 space-y-2 overflow-auto">
                {previewData.elements.map((element) => (
                  <div
                    key={element.id}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs"
                  >
                    <p className="font-medium text-zinc-900">
                      #{element.render_order + 1} - {element.id || "-"} ({element.type})
                    </p>
                    <p className="font-mono text-[11px] text-zinc-600">
                      x:{element.x_mm} y:{element.y_mm} w:{element.width_mm} h:{element.height_mm}
                    </p>
                    <p className="mt-1 text-zinc-800">
                      <span className="font-medium">
                        {t("licenseCardPreviewResolvedValueLabel")}:
                      </span>{" "}
                      {getPreviewElementResolvedValue(element)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
              <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {t("licenseCardPreviewSlotLayoutTitle")}
              </h3>
              <div className="max-h-72 space-y-2 overflow-auto">
                {previewData.slots.length === 0 ? (
                  <p className="text-xs text-zinc-500">{t("licenseCardPreviewNoSlotsAvailable")}</p>
                ) : (
                  previewData.slots.map((slot) => (
                    <div
                      key={slot.slot_index}
                      className={`rounded-md border px-2 py-2 text-xs ${
                        slot.selected
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                    >
                      <p className="font-medium">
                        {t("licenseCardPreviewSlotLabel", { index: slot.slot_index })}
                      </p>
                      <p>
                        r{slot.row} c{slot.column}
                      </p>
                      <p className="font-mono text-[11px]">
                        x:{slot.x_mm} y:{slot.y_mm} w:{slot.width_mm} h:{slot.height_mm}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
            </div>
          </div>
        )}
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-700">
                {t("licenseCardDesignerCanvasActiveSideBadge", { side: activeSideLabel })}
              </span>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                <Checkbox
                  checked={isLivePrintSimulationEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = Boolean(checked);
                    setIsLivePrintSimulationEnabled(enabled);
                    if (!enabled) {
                      setLiveSimulationError(null);
                    }
                  }}
                />
                {t("licenseCardPreviewSimulationToggleLabel")}
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={!selectedVersion || !isLivePrintSimulationEnabled || isLoadingLiveSimulation}
                onClick={() => void handleRefreshLiveSimulation()}
              >
                {isLoadingLiveSimulation
                  ? t("licenseCardPreviewSimulationRefreshingAction")
                  : t("licenseCardPreviewSimulationRefreshAction")}
              </Button>
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
            <>
            <div
              className={`overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 p-4 ${
                isLivePrintSimulationEnabled ? "hidden" : ""
              }`}
            >
              <div
                className="relative mx-auto"
                style={{
                  width: canvasWidthPx + (showRulers ? RULER_SIZE_PX : 0),
                  height: canvasHeightPx + (showRulers ? RULER_SIZE_PX : 0),
                }}
              >
                {showRulers ? (
                  <>
                    <div
                      className="pointer-events-none absolute left-0 top-0 border-b border-r border-zinc-300 bg-zinc-100"
                      style={{ width: RULER_SIZE_PX, height: RULER_SIZE_PX }}
                    />
                    <div
                      className="pointer-events-none absolute top-0 border-b border-zinc-300 bg-zinc-100"
                      style={{
                        left: RULER_SIZE_PX,
                        width: canvasWidthPx,
                        height: RULER_SIZE_PX,
                      }}
                    >
                      {rulerMarksX.map((mark) => (
                        <div
                          key={`ruler-x-${mark}`}
                          className="absolute bottom-0"
                          style={{ left: mark * canvasScale }}
                        >
                          <div
                            className="w-px bg-zinc-500"
                            style={{
                              height: mark % 10 === 0 ? 12 : mark % 5 === 0 ? 8 : 5,
                            }}
                          />
                          {mark % 10 === 0 ? (
                            <span className="absolute -top-4 left-1 text-[9px] text-zinc-500">
                              {mark}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div
                      className="pointer-events-none absolute left-0 border-r border-zinc-300 bg-zinc-100"
                      style={{
                        top: RULER_SIZE_PX,
                        width: RULER_SIZE_PX,
                        height: canvasHeightPx,
                      }}
                    >
                      {rulerMarksY.map((mark) => (
                        <div
                          key={`ruler-y-${mark}`}
                          className="absolute right-0"
                          style={{ top: mark * canvasScale }}
                        >
                          <div
                            className="h-px bg-zinc-500"
                            style={{
                              width: mark % 10 === 0 ? 12 : mark % 5 === 0 ? 8 : 5,
                            }}
                          />
                          {mark % 10 === 0 ? (
                            <span className="absolute -left-5 -top-1 text-[9px] text-zinc-500">
                              {mark}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                <div
                  ref={canvasRef}
                  className="relative bg-white shadow-md"
                  style={{
                    width: canvasWidthPx,
                    height: canvasHeightPx,
                    marginLeft: showRulers ? RULER_SIZE_PX : 0,
                    marginTop: showRulers ? RULER_SIZE_PX : 0,
                  }}
                  onDragOver={onCanvasDragOver}
                  onDrop={onCanvasDrop}
                  onClick={() => {
                    clearElementSelection();
                    setSnapGuideLines([]);
                    setLiveMeasurementBounds(null);
                  }}
                >
                  {showGrid ? (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, rgba(148, 163, 184, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.35) 1px, transparent 1px)",
                        backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`,
                      }}
                    />
                  ) : null}
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
                  {snapGuideLines.map((line, index) => {
                    if (line.orientation === "vertical") {
                      return (
                        <div
                          key={`snap-line-v-${index}`}
                          className={`pointer-events-none absolute inset-y-0 w-px ${
                            line.source === "element" ? "bg-blue-500/80" : "bg-emerald-500/70"
                          }`}
                          style={{ left: line.value_mm * canvasScale }}
                        />
                      );
                    }
                    return (
                      <div
                        key={`snap-line-h-${index}`}
                        className={`pointer-events-none absolute inset-x-0 h-px ${
                          line.source === "element" ? "bg-blue-500/80" : "bg-emerald-500/70"
                        }`}
                        style={{ top: line.value_mm * canvasScale }}
                      />
                    );
                  })}
                  {liveMeasurementBounds ? (
                    <>
                      <div
                        className="pointer-events-none absolute border border-dashed border-blue-500/80"
                        style={{
                          left: liveMeasurementBounds.left * canvasScale,
                          top: liveMeasurementBounds.top * canvasScale,
                          width: liveMeasurementBounds.width * canvasScale,
                          height: liveMeasurementBounds.height * canvasScale,
                        }}
                      />
                      <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-zinc-900/85 px-2 py-1 text-[10px] text-white">
                        {t("licenseCardEditorMeasurementReadout", {
                          x: liveMeasurementBounds.left.toFixed(2),
                          y: liveMeasurementBounds.top.toFixed(2),
                          width: liveMeasurementBounds.width.toFixed(2),
                          height: liveMeasurementBounds.height.toFixed(2),
                        })}
                      </div>
                    </>
                  ) : null}

                  {designPayload.elements.map((element) => {
                    const isSelected = effectiveSelectedElementIds.includes(element.id);
                    const groupId = getElementGroupId(element);
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
                        }}
                      >
                        <span className="pointer-events-none line-clamp-2">{elementContent}</span>
                        {groupId ? (
                          <span className="pointer-events-none absolute left-1 top-0 rounded bg-zinc-800/80 px-1 text-[9px] text-white">
                            G
                          </span>
                        ) : null}
                        {isSelected && isEditableDraft && selectedCount === 1 ? (
                          <button
                            type="button"
                            className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border border-blue-600 bg-blue-200 shadow-sm"
                            onMouseDown={(event) => handleResizeHandleMouseDown(event, element)}
                            aria-label={t("licenseCardEditorResizeHandleLabel")}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {isLivePrintSimulationEnabled ? (
              <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-100 p-4">
                <div className="text-xs text-zinc-600">
                  {t("licenseCardPreviewSimulationActiveSideLabel", { side: activeSideLabel })}
                </div>
                {liveSimulationError ? (
                  <p className="text-xs text-red-600">{liveSimulationError}</p>
                ) : null}
                {!isLoadingLiveSimulation && !liveSimulationSrcDoc ? (
                  <p className="text-xs text-zinc-500">
                    {t("licenseCardPreviewSimulationEmptyHint")}
                  </p>
                ) : null}
                <div className="mx-auto overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm">
                  <iframe
                    title={t("licenseCardPreviewSimulationFrameTitle")}
                    className="block border-0"
                    style={{ width: canvasWidthPx, height: canvasHeightPx }}
                    srcDoc={liveSimulationSrcDoc}
                  />
                </div>
              </div>
            ) : null}
            </>
          )}
        </section>

        <section className="space-y-4 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm">
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">
                {t("licenseCardEditorLayerPanelTitle")}
              </h2>
              <span className="text-xs text-zinc-500">
                {t("licenseCardEditorLayerCountLabel", { count: designPayload.elements.length })}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!isEditableDraft || selectedCount === 0}
                onClick={() => moveSelectedLayers("forward")}
              >
                {t("licenseCardEditorBringForwardAction")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!isEditableDraft || selectedCount === 0}
                onClick={() => moveSelectedLayers("backward")}
              >
                {t("licenseCardEditorSendBackwardAction")}
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-auto">
              {layersTopToBottom.length === 0 ? (
                <p className="text-xs text-zinc-500">{t("licenseCardEditorLayerPanelEmpty")}</p>
              ) : (
                layersTopToBottom.map((element, index) => {
                  const isSelected = effectiveSelectedElementIds.includes(element.id);
                  const groupId = getElementGroupId(element);
                  return (
                    <div
                      key={`layer-${element.id}`}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                        isSelected
                          ? "border-blue-400 bg-blue-50 text-blue-700"
                          : "border-zinc-200 bg-white text-zinc-700"
                      }`}
                      draggable={isEditableDraft}
                      onDragStart={() => setDraggedLayerId(element.id)}
                      onDragEnd={() => setDraggedLayerId(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={() => {
                        if (draggedLayerId) {
                          reorderLayersByDrag(draggedLayerId, element.id);
                        }
                        setDraggedLayerId(null);
                      }}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={(event) => {
                          if (event.shiftKey) {
                            toggleElementSelection(element.id);
                            return;
                          }
                          setSingleElementSelection(element.id);
                        }}
                      >
                        <p className="truncate font-medium">
                          {index + 1}. {toolLabelByType[element.type]}
                        </p>
                        <p className="truncate text-[10px] text-zinc-500">{element.id}</p>
                      </button>
                      {groupId ? (
                        <span className="rounded bg-zinc-800 px-1 text-[9px] text-white">G</span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        disabled={!isEditableDraft}
                        onClick={() => moveSingleLayer(element.id, "forward")}
                      >
                        {t("licenseCardEditorLayerUpAction")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        disabled={!isEditableDraft}
                        onClick={() => moveSingleLayer(element.id, "backward")}
                      >
                        {t("licenseCardEditorLayerDownAction")}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">
                {t("licenseCardAssetLibraryTitle")}
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAssetLibraryOpen(true)}
              >
                {t("licenseCardAssetLibraryManageAction")}
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              {t("licenseCardAssetLibrarySummary", {
                fontCount: fontAssets.length,
                imageCount: imageAssets.length,
              })}
            </p>
            {selectedElement?.type === "text" ? (
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase text-zinc-500">
                  {t("licenseCardAssetLibraryFontQuickSelectLabel")}
                </label>
                <Select
                  disabled={!isEditableDraft || fontAssets.length === 0}
                  value={selectedFontAssetId ? String(selectedFontAssetId) : "none"}
                  onValueChange={(value) => {
                    setSelectedElementStylePatch({
                      font_asset_id: value === "none" ? undefined : Number(value),
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t("licenseCardAssetLibraryFontQuickSelectPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("licenseCardDesignerNoMergeFieldOption")}</SelectItem>
                    {fontAssets.map((asset) => (
                      <SelectItem key={asset.id} value={String(asset.id)}>
                        {asset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {selectedElement?.type === "image" ? (
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase text-zinc-500">
                  {t("licenseCardAssetLibraryImageQuickSelectLabel")}
                </label>
                <Select
                  disabled={!isEditableDraft || imageAssets.length === 0}
                  value={selectedImageAssetId ? String(selectedImageAssetId) : "none"}
                  onValueChange={(value) => {
                    const nextAssetId = value === "none" ? null : Number(value);
                    applySelectedImageAsset(nextAssetId);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={t("licenseCardAssetLibraryImageQuickSelectPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("licenseCardDesignerNoMergeFieldOption")}</SelectItem>
                    {imageAssets.map((asset) => (
                      <SelectItem key={asset.id} value={String(asset.id)}>
                        {asset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <h2 className="text-sm font-semibold text-zinc-900">
            {t("licenseCardDesignerInspectorTitle")}
          </h2>
          {!selectedElement ? (
            <p className="text-sm text-zinc-500">
              {t("licenseCardDesignerInspectorEmpty")}
            </p>
          ) : (
            <div className="space-y-4">
              {selectedCount > 1 ? (
                <p className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  {t("licenseCardEditorMultiSelectionInspectorHint", { count: selectedCount })}
                </p>
              ) : null}
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
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerRotationDegLabel")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    value={selectedElement.rotation_deg ?? ""}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const rawValue = event.target.value;
                      if (!rawValue.trim()) {
                        setSelectedElementField("rotation_deg", undefined);
                        return;
                      }
                      const nextValue = Number(rawValue);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      setSelectedElementField("rotation_deg", nextValue);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase text-zinc-500">
                    {t("licenseCardDesignerOpacityLabel")}
                  </label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedElement.opacity ?? ""}
                    disabled={!isEditableDraft}
                    onChange={(event) => {
                      const rawValue = event.target.value;
                      if (!rawValue.trim()) {
                        setSelectedElementField("opacity", undefined);
                        return;
                      }
                      const nextValue = Number(rawValue);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      setSelectedElementField("opacity", Math.min(1, Math.max(0, nextValue)));
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase text-zinc-500">
                  {t("licenseCardDesignerZIndexLabel")}
                </label>
                <Input
                  type="number"
                  step="1"
                  value={selectedElement.z_index ?? ""}
                  disabled={!isEditableDraft}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    if (!rawValue.trim()) {
                      setSelectedElementField("z_index", undefined);
                      return;
                    }
                    const nextValue = Number.parseInt(rawValue, 10);
                    if (!Number.isFinite(nextValue)) {
                      return;
                    }
                    setSelectedElementField("z_index", nextValue);
                  }}
                />
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
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <h3 className="text-xs font-semibold uppercase text-zinc-600">
                    {t("licenseCardInspectorTextAdvancedTitle")}
                  </h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardDesignerTextLabel")}
                    </label>
                    <textarea
                      className="min-h-[84px] w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                      value={selectedElement.text || ""}
                      disabled={!isEditableDraft}
                      onChange={(event) => {
                        setSelectedElementField("text", event.target.value);
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorFontAssetLabel")}
                      </label>
                      <Select
                        disabled={!isEditableDraft || fontAssets.length === 0}
                        value={selectedFontAssetId ? String(selectedFontAssetId) : "none"}
                        onValueChange={(value) => {
                          setSelectedElementStylePatch({
                            font_asset_id: value === "none" ? undefined : Number(value),
                          });
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("licenseCardInspectorFontAssetPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("licenseCardDesignerNoMergeFieldOption")}</SelectItem>
                          {fontAssets.map((asset) => (
                            <SelectItem key={asset.id} value={String(asset.id)}>
                              {asset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorFontFamilyLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "font_family")}
                        disabled={!isEditableDraft}
                        placeholder="Inter"
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            font_family: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorFontSizeLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        value={getStyleStringValue(selectedElementStyle, "font_size_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            font_size_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorTextColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "color")}
                        disabled={!isEditableDraft}
                        placeholder="#111827"
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            color: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorFontWeightLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "font_weight")}
                        disabled={!isEditableDraft}
                        placeholder="500"
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            font_weight: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorLineHeightLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "line_height", "1.2")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            line_height: event.target.value,
                          });
                        }}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    <Checkbox
                      checked={getStyleBooleanValue(selectedElementStyle, "italic", false)}
                      onCheckedChange={(checked) => {
                        setSelectedElementStylePatch({
                          italic: Boolean(checked),
                        });
                      }}
                      disabled={!isEditableDraft}
                    />
                    <span>{t("licenseCardInspectorItalicToggleLabel")}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorTextAlignLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "text_align", "left")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            text_align: event.target.value,
                          });
                        }}
                      >
                        {TEXT_ALIGN_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorLetterSpacingLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "letter_spacing_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            letter_spacing_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorTextTransformLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "text_transform", "none")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            text_transform: event.target.value,
                          });
                        }}
                      >
                        {TEXT_TRANSFORM_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorTextDecorationLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "text_decoration", "none")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            text_decoration: event.target.value,
                          });
                        }}
                      >
                        {TEXT_DECORATION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorShadowColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "shadow_color")}
                        disabled={!isEditableDraft}
                        placeholder="rgba(0,0,0,0.35)"
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            shadow_color: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorShadowBlurLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "shadow_blur_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            shadow_blur_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorShadowOffsetXLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "shadow_offset_x_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            shadow_offset_x_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorShadowOffsetYLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "shadow_offset_y_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            shadow_offset_y_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorStrokeColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "stroke_color")}
                        disabled={!isEditableDraft}
                        placeholder="#ffffff"
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            stroke_color: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorStrokeWidthLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "stroke_width_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            stroke_width_mm: event.target.value,
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedElement.type === "image" ? (
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <h3 className="text-xs font-semibold uppercase text-zinc-600">
                    {t("licenseCardInspectorImageAdvancedTitle")}
                  </h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardInspectorImageSourceModeLabel")}
                    </label>
                    <select
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                      value={selectedImageSourceMode}
                      disabled={!isEditableDraft}
                      onChange={(event) => {
                        const nextMode = event.target.value;
                        updateSelectedElement((element) => {
                          if (element.type !== "image") {
                            return element;
                          }
                          const nextStyle = normalizeElementStyle(element);
                          if (nextMode === "asset") {
                            const fallbackAssetId = selectedImageAssetId ?? imageAssets[0]?.id ?? null;
                            if (fallbackAssetId) {
                              nextStyle.image_asset_id = fallbackAssetId;
                            }
                            return {
                              ...element,
                              merge_field: undefined,
                              source: undefined,
                              style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
                            };
                          }
                          delete nextStyle.image_asset_id;
                          if (nextMode === "merge") {
                            const defaultMergeField = mergeFieldKeySet.has("member.profile_picture_processed")
                              ? "member.profile_picture_processed"
                              : "club.logo_print_url";
                            return {
                              ...element,
                              merge_field: element.merge_field || defaultMergeField,
                              source: undefined,
                              style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
                            };
                          }
                          return {
                            ...element,
                            merge_field: undefined,
                            source: element.source || "",
                            style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
                          };
                        });
                      }}
                    >
                      <option value="source">{t("licenseCardInspectorImageSourceModeDirectOption")}</option>
                      <option value="merge">{t("licenseCardInspectorImageSourceModeMergeOption")}</option>
                      <option value="asset">{t("licenseCardInspectorImageSourceModeAssetOption")}</option>
                    </select>
                  </div>
                  {selectedImageSourceMode === "source" ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardDesignerImageSourceLabel")}
                      </label>
                      <Input
                        value={selectedElement.source || ""}
                        disabled={!isEditableDraft}
                        placeholder={t("licenseCardDesignerImageSourcePlaceholder")}
                        onChange={(event) => {
                          setSelectedElementField("source", event.target.value);
                        }}
                      />
                    </div>
                  ) : null}
                  {selectedImageSourceMode === "merge" ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase text-zinc-500">
                          {t("licenseCardDesignerMergeFieldLabel")}
                        </label>
                        <Select
                          disabled={!isEditableDraft}
                          value={selectedElement.merge_field || "none"}
                          onValueChange={(value) => {
                            setSelectedElementField(
                              "merge_field",
                              value === "none" ? undefined : value
                            );
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("licenseCardDesignerMergeFieldPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              {t("licenseCardDesignerNoMergeFieldOption")}
                            </SelectItem>
                            {mergeFields.map((field) => (
                              <SelectItem key={field.key} value={field.key}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isEditableDraft}
                          onClick={() => applyImageMergePreset("member.profile_picture_processed")}
                        >
                          {t("licenseCardInspectorInsertMemberPhotoAction")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isEditableDraft}
                          onClick={() => applyImageMergePreset("club.logo_print_url")}
                        >
                          {t("licenseCardInspectorInsertClubLogoAction")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {selectedImageSourceMode === "asset" ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorImageAssetLabel")}
                      </label>
                      <Select
                        disabled={!isEditableDraft || imageAssets.length === 0}
                        value={selectedImageAssetId ? String(selectedImageAssetId) : "none"}
                        onValueChange={(value) => {
                          applySelectedImageAsset(value === "none" ? null : Number(value));
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("licenseCardInspectorImageAssetPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("licenseCardDesignerNoMergeFieldOption")}</SelectItem>
                          {imageAssets.map((asset) => (
                            <SelectItem key={asset.id} value={String(asset.id)}>
                              {asset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedImageAsset ? (
                        <p className="text-xs text-emerald-700">
                          {t("licenseCardInspectorImageAssetSelectedIndicator", {
                            name: selectedImageAsset.name,
                            id: selectedImageAsset.id,
                            format: selectedImageAssetIsSvg
                              ? t("licenseCardInspectorImageAssetFormatSvg")
                              : t("licenseCardInspectorImageAssetFormatRaster"),
                          })}
                        </p>
                      ) : selectedImageAssetId ? (
                        <p className="text-xs text-amber-700">
                          {t("licenseCardInspectorImageAssetMissingIndicator", {
                            id: selectedImageAssetId,
                          })}
                        </p>
                      ) : (
                        <p className="text-xs text-zinc-500">
                          {t("licenseCardInspectorImageAssetNoneSelectedIndicator")}
                        </p>
                      )}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorObjectFitLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "object_fit", "contain")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ object_fit: event.target.value });
                        }}
                      >
                        {OBJECT_FIT_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorBorderColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "border_color")}
                        disabled={!isEditableDraft}
                        placeholder="#1d4ed8"
                        onChange={(event) => {
                          setSelectedElementStylePatch({ border_color: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorBorderWidthLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "border_width_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ border_width_mm: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusTopLeftLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_top_left_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_top_left_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusTopRightLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_top_right_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_top_right_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusBottomRightLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_bottom_right_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_bottom_right_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusBottomLeftLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_bottom_left_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_bottom_left_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedElement.type === "shape" ? (
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <h3 className="text-xs font-semibold uppercase text-zinc-600">
                    {t("licenseCardInspectorShapeAdvancedTitle")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorShapeKindLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "shape_kind", "rectangle")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ shape_kind: event.target.value });
                        }}
                      >
                        {SHAPE_KIND_OPTIONS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorBorderStyleLabel")}
                      </label>
                      <select
                        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={getStyleStringValue(selectedElementStyle, "border_style", "solid")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ border_style: event.target.value });
                        }}
                      >
                        {BORDER_STYLE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorFillColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "fill_color")}
                        disabled={!isEditableDraft}
                        placeholder="#e2e8f0"
                        onChange={(event) => {
                          setSelectedElementStylePatch({ fill_color: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorStrokeColorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "stroke_color")}
                        disabled={!isEditableDraft}
                        placeholder="#1f2937"
                        onChange={(event) => {
                          setSelectedElementStylePatch({ stroke_color: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorStrokeWidthLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "stroke_width_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ stroke_width_mm: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorBorderRadiusLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleStringValue(selectedElementStyle, "border_radius_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({ border_radius_mm: event.target.value });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusTopLeftLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_top_left_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_top_left_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusTopRightLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_top_right_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_top_right_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusBottomRightLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_bottom_right_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_bottom_right_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorRadiusBottomLeftLabel")}
                      </label>
                      <Input
                        type="number"
                        step="0.05"
                        value={getStyleCornerRadiusValue(selectedElementStyle, "radius_bottom_left_mm")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch(
                            buildCornerRadiusStylePatch(
                              selectedElementStyle,
                              "radius_bottom_left_mm",
                              event.target.value
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-zinc-600">
                    <Checkbox
                      checked={selectedShapeUsesGradient}
                      onCheckedChange={(checked) => {
                        const enabled = Boolean(checked);
                        setSelectedElementStylePatch(
                          buildShapeGradientStylePatch(selectedElementStyle, {
                            enabled,
                          })
                        );
                      }}
                      disabled={!isEditableDraft}
                    />
                    <span>{t("licenseCardInspectorShapeGradientToggleLabel")}</span>
                  </label>
                  {selectedShapeUsesGradient ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase text-zinc-500">
                          {t("licenseCardInspectorGradientStartLabel")}
                        </label>
                        <Input
                          value={selectedShapeGradientState.startColor}
                          disabled={!isEditableDraft}
                          placeholder="#ef4444"
                          onChange={(event) => {
                            setSelectedElementStylePatch(
                              buildShapeGradientStylePatch(selectedElementStyle, {
                                startColor: event.target.value,
                              })
                            );
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase text-zinc-500">
                          {t("licenseCardInspectorGradientEndLabel")}
                        </label>
                        <Input
                          value={selectedShapeGradientState.endColor}
                          disabled={!isEditableDraft}
                          placeholder="#3b82f6"
                          onChange={(event) => {
                            setSelectedElementStylePatch(
                              buildShapeGradientStylePatch(selectedElementStyle, {
                                endColor: event.target.value,
                              })
                            );
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase text-zinc-500">
                          {t("licenseCardInspectorGradientAngleLabel")}
                        </label>
                        <Input
                          type="number"
                          step="1"
                          value={selectedShapeGradientState.angleDeg}
                          disabled={!isEditableDraft}
                          onChange={(event) => {
                            setSelectedElementStylePatch(
                              buildShapeGradientStylePatch(selectedElementStyle, {
                                angleDeg: event.target.value,
                              })
                            );
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedElement.type === "qr" ? (
                <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <h3 className="text-xs font-semibold uppercase text-zinc-600">
                    {t("licenseCardInspectorQrAdvancedTitle")}
                  </h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardInspectorQrModeLabel")}
                    </label>
                    <select
                      className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                      value={selectedQrDataMode}
                      disabled={!isEditableDraft}
                      onChange={(event) => {
                        const nextMode = event.target.value;
                        if (!QR_DATA_MODE_OPTIONS.includes(nextMode as (typeof QR_DATA_MODE_OPTIONS)[number])) {
                          return;
                        }
                        if (nextMode === "single_merge") {
                          setSelectedElementStylePatch({
                            data_mode: nextMode,
                            merge_fields: undefined,
                            custom_data: undefined,
                          });
                        } else if (nextMode === "multi_merge") {
                          setSelectedElementStylePatch({
                            data_mode: nextMode,
                            custom_data: undefined,
                            merge_fields:
                              selectedQrMergeFields.length > 0
                                ? selectedQrMergeFields
                                : [selectedElement.merge_field || "member.ltf_licenseid"],
                          });
                        } else {
                          setSelectedElementStylePatch({
                            data_mode: nextMode,
                            merge_fields: undefined,
                            custom_data: getStyleStringValue(
                              selectedElementStyle,
                              "custom_data",
                              "{{member.ltf_licenseid}}"
                            ),
                          });
                        }
                      }}
                    >
                      <option value="single_merge">
                        {t("licenseCardInspectorQrModeSingleOption")}
                      </option>
                      <option value="multi_merge">{t("licenseCardInspectorQrModeMultiOption")}</option>
                      <option value="custom">{t("licenseCardInspectorQrModeCustomOption")}</option>
                    </select>
                  </div>
                  {selectedQrDataMode === "single_merge" ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardDesignerMergeFieldLabel")}
                      </label>
                      <Select
                        disabled={!isEditableDraft}
                        value={selectedElement.merge_field || "none"}
                        onValueChange={(value) => {
                          setSelectedElementField("merge_field", value === "none" ? undefined : value);
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
                  {selectedQrDataMode === "multi_merge" ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrMergeFieldsLabel")}
                      </label>
                      <select
                        multiple
                        className="min-h-[88px] w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
                        value={selectedQrMergeFields}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          const selectedValues = Array.from(event.target.selectedOptions).map(
                            (option) => option.value
                          );
                          setSelectedElementStylePatch({
                            merge_fields: selectedValues.length > 0 ? selectedValues : undefined,
                          });
                        }}
                      >
                        {mergeFields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {selectedQrDataMode === "custom" ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrCustomDataLabel")}
                      </label>
                      <textarea
                        className="min-h-[76px] w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                        value={getStyleStringValue(selectedElementStyle, "custom_data")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            custom_data: event.target.value,
                          });
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrSeparatorLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "separator", "|")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            separator: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrQuietZoneLabel")}
                      </label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={getStyleStringValue(selectedElementStyle, "quiet_zone_modules", "1")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            quiet_zone_modules: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrForegroundLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "foreground_color", "#111827")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            foreground_color: event.target.value,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase text-zinc-500">
                        {t("licenseCardInspectorQrBackgroundLabel")}
                      </label>
                      <Input
                        value={getStyleStringValue(selectedElementStyle, "background_color", "#ffffff")}
                        disabled={!isEditableDraft}
                        onChange={(event) => {
                          setSelectedElementStylePatch({
                            background_color: event.target.value,
                          });
                        }}
                      />
                    </div>
                  </div>
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

          <Modal
            title={t("licenseCardAssetLibraryModalTitle")}
            description={t("licenseCardAssetLibraryModalSubtitle")}
            isOpen={isAssetLibraryOpen}
            onClose={() => {
              if (isUploadingFontAsset || isUploadingImageAsset) {
                return;
              }
              resetFontAssetInput();
              resetImageAssetInput();
              setIsAssetLibraryOpen(false);
            }}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={assetLibraryTab === "fonts" ? "default" : "outline"}
                  onClick={() => setAssetLibraryTab("fonts")}
                >
                  {t("licenseCardAssetLibraryFontsTab")}
                </Button>
                <Button
                  size="sm"
                  variant={assetLibraryTab === "images" ? "default" : "outline"}
                  onClick={() => setAssetLibraryTab("images")}
                >
                  {t("licenseCardAssetLibraryImagesTab")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refreshAssetLibraries()}>
                  {t("refreshAction")}
                </Button>
              </div>
              {assetLibraryTab === "fonts" ? (
                <div className="space-y-3">
                  <div className="grid gap-2 rounded-md border border-zinc-200 p-3">
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardAssetLibraryFontNameLabel")}
                    </label>
                    <Input
                      value={newFontAssetName}
                      disabled={isUploadingFontAsset}
                      placeholder={t("licenseCardAssetLibraryFontNamePlaceholder")}
                      onChange={(event) => setNewFontAssetName(event.target.value)}
                    />
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardAssetLibraryFontFileLabel")}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fontAssetInputRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        className="hidden"
                        disabled={isUploadingFontAsset}
                        onChange={handleFontAssetFileChange}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isUploadingFontAsset}
                        onClick={openFontAssetFilePicker}
                      >
                        {t("licenseCardAssetLibraryChooseFontFileAction")}
                      </Button>
                      <p className="text-xs text-zinc-600">
                        {t("selectedFileLabel")}: {newFontAssetFile?.name || t("noFileSelected")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isUploadingFontAsset || !newFontAssetFile}
                      onClick={() => void handleUploadFontAsset()}
                    >
                      {isUploadingFontAsset
                        ? t("licenseCardAssetLibraryUploadingAction")
                        : t("licenseCardAssetLibraryUploadFontAction")}
                    </Button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-zinc-200 p-2">
                    {fontAssets.length === 0 ? (
                      <p className="text-xs text-zinc-500">{t("licenseCardAssetLibraryNoFonts")}</p>
                    ) : (
                      fontAssets.map((asset) => (
                        <div
                          key={`font-asset-${asset.id}`}
                          className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-800">{asset.name}</p>
                            <p className="truncate text-[10px] text-zinc-500">{asset.file}</p>
                          </div>
                          {selectedElement?.type === "text" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={!isEditableDraft}
                              onClick={() => {
                                setSelectedElementStylePatch({ font_asset_id: asset.id });
                              }}
                            >
                              {t("licenseCardAssetLibraryApplyAction")}
                            </Button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-2 rounded-md border border-zinc-200 p-3">
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardAssetLibraryImageNameLabel")}
                    </label>
                    <Input
                      value={newImageAssetName}
                      disabled={isUploadingImageAsset}
                      placeholder={t("licenseCardAssetLibraryImageNamePlaceholder")}
                      onChange={(event) => setNewImageAssetName(event.target.value)}
                    />
                    <label className="text-xs font-medium uppercase text-zinc-500">
                      {t("licenseCardAssetLibraryImageFileLabel")}
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={imageAssetInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,.svg"
                        className="hidden"
                        disabled={isUploadingImageAsset}
                        onChange={handleImageAssetFileChange}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isUploadingImageAsset}
                        onClick={openImageAssetFilePicker}
                      >
                        {t("licenseCardAssetLibraryChooseImageFileAction")}
                      </Button>
                      <p className="text-xs text-zinc-600">
                        {t("selectedFileLabel")}: {newImageAssetFile?.name || t("noFileSelected")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isUploadingImageAsset || !newImageAssetFile}
                      onClick={() => void handleUploadImageAsset()}
                    >
                      {isUploadingImageAsset
                        ? t("licenseCardAssetLibraryUploadingAction")
                        : t("licenseCardAssetLibraryUploadImageAction")}
                    </Button>
                  </div>
                  <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-zinc-200 p-2">
                    {imageAssets.length === 0 ? (
                      <p className="text-xs text-zinc-500">{t("licenseCardAssetLibraryNoImages")}</p>
                    ) : (
                      imageAssets.map((asset) => (
                        <div
                          key={`image-asset-${asset.id}`}
                          className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-800">{asset.name}</p>
                            <p className="truncate text-[10px] text-zinc-500">{asset.image}</p>
                          </div>
                          {selectedElement?.type === "image" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              disabled={!isEditableDraft}
                              onClick={() => {
                                applySelectedImageAsset(asset.id);
                              }}
                            >
                              {t("licenseCardAssetLibraryApplyAction")}
                            </Button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </Modal>
        </section>
      </div>
    </LtfAdminLayout>
  );
}
