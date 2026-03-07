import type { CardPreviewHtmlResponse } from "@/lib/license-card-api";

const DEFAULT_CARD_WIDTH_MM = 85;
const DEFAULT_CARD_HEIGHT_MM = 55;
const CSS_PX_PER_MM = 96 / 25.4;

export type CardSimulationFrameLayout = {
  naturalWidthPx: number;
  naturalHeightPx: number;
  scale: number;
  renderedWidthPx: number;
  renderedHeightPx: number;
};

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

export function calculateCardSimulationFrameLayout(
  payload: CardPreviewHtmlResponse | null,
  viewportWidthPx: number,
  viewportHeightPx: number
): CardSimulationFrameLayout {
  const safeViewportWidthPx = Math.max(1, toFiniteNumber(viewportWidthPx, 1));
  const safeViewportHeightPx = Math.max(1, toFiniteNumber(viewportHeightPx, 1));
  const cardWidthMm = Math.max(
    0.01,
    toFiniteNumber(payload?.card_format?.width_mm, DEFAULT_CARD_WIDTH_MM)
  );
  const cardHeightMm = Math.max(
    0.01,
    toFiniteNumber(payload?.card_format?.height_mm, DEFAULT_CARD_HEIGHT_MM)
  );
  const naturalWidthPx = Math.max(1, cardWidthMm * CSS_PX_PER_MM);
  const naturalHeightPx = Math.max(1, cardHeightMm * CSS_PX_PER_MM);
  const widthScale = safeViewportWidthPx / naturalWidthPx;
  const heightScale = safeViewportHeightPx / naturalHeightPx;
  const scale = clamp(Math.min(widthScale, heightScale), 0.1, 12);

  return {
    naturalWidthPx,
    naturalHeightPx,
    scale,
    renderedWidthPx: naturalWidthPx * scale,
    renderedHeightPx: naturalHeightPx * scale,
  };
}

export function buildCardSimulationSrcDoc(payload: CardPreviewHtmlResponse | null) {
  if (!payload) {
    return "";
  }
  const simulationHtml = payload.html || "";
  const simulationCss = payload.css || "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${simulationCss}</style></head><body>${simulationHtml}</body></html>`;
}
