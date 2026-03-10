import type { CardPreviewHtmlResponse } from "@/lib/license-card-api";

const DEFAULT_CARD_WIDTH_MM = 85;
const DEFAULT_CARD_HEIGHT_MM = 55;
const CSS_PX_PER_MM = 96 / 25.4;
const PDF_POINTS_PER_INCH = 72;
const CSS_PIXELS_PER_INCH = 96;
const PDF_PREVIEW_SCALE = PDF_POINTS_PER_INCH / CSS_PIXELS_PER_INCH;
const PDF_PIXEL_RATIO = CSS_PIXELS_PER_INCH / PDF_POINTS_PER_INCH;

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

export function calculateCardSimulationFrameLayout(
  payload: CardPreviewHtmlResponse | null
): CardSimulationFrameLayout {
  const cardWidthMm = Math.max(
    0.01,
    toFiniteNumber(payload?.card_format?.width_mm, DEFAULT_CARD_WIDTH_MM)
  );
  const cardHeightMm = Math.max(
    0.01,
    toFiniteNumber(payload?.card_format?.height_mm, DEFAULT_CARD_HEIGHT_MM)
  );
  // Render the iframe source document at PDF-space dimensions first,
  // then downscale by 72/96 so CSS mm maps 1:1 with PDF points.
  const naturalWidthPx = Math.max(1, cardWidthMm * CSS_PX_PER_MM * PDF_PIXEL_RATIO);
  const naturalHeightPx = Math.max(1, cardHeightMm * CSS_PX_PER_MM * PDF_PIXEL_RATIO);
  // Match browser PDF preview scale (PDF points are 72dpi vs CSS 96dpi).
  const scale = PDF_PREVIEW_SCALE;

  return {
    naturalWidthPx,
    naturalHeightPx,
    scale,
    renderedWidthPx: Math.max(1, naturalWidthPx * scale),
    renderedHeightPx: Math.max(1, naturalHeightPx * scale),
  };
}

export function buildCardSimulationSrcDoc(payload: CardPreviewHtmlResponse | null) {
  if (!payload) {
    return "";
  }
  const layout = calculateCardSimulationFrameLayout(payload);
  const simulationHtml = payload.html || "";
  const simulationCss = payload.css || "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${simulationCss}</style><style>html,body{margin:0;padding:0;overflow:hidden;-webkit-text-size-adjust:100%;text-size-adjust:100%;width:${layout.naturalWidthPx}px;height:${layout.naturalHeightPx}px;}#card-simulation-root{width:${layout.naturalWidthPx}px;height:${layout.naturalHeightPx}px;display:inline-block;transform-origin:top left;transform:scale(${layout.scale.toFixed(6)});will-change:transform;contain:layout style paint;}</style></head><body><div id="card-simulation-root">${simulationHtml}</div></body></html>`;
}
