const DEFAULT_GRADIENT_START_COLOR = "#ef4444";
const DEFAULT_GRADIENT_END_COLOR = "#3b82f6";
const DEFAULT_GRADIENT_ANGLE_DEG = "90";

type ShapeGradientObject = {
  start_color?: unknown;
  end_color?: unknown;
  angle_deg?: unknown;
};

type ShapeGradientPatchInput = {
  enabled?: boolean;
  startColor?: string;
  endColor?: string;
  angleDeg?: string;
};

export type ShapeGradientState = {
  enabled: boolean;
  startColor: string;
  endColor: string;
  angleDeg: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function normalizeColor(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeAngle(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return String(parsed);
}

function parseGradientObject(style: Record<string, unknown>): ShapeGradientObject | null {
  const value = style.fill_gradient;
  if (!isPlainObject(value)) {
    return null;
  }
  return value as ShapeGradientObject;
}

export function resolveShapeGradientState(style: Record<string, unknown>): ShapeGradientState {
  const gradientObject = parseGradientObject(style);
  const legacyStart = readString(style.fill_gradient_start);
  const legacyEnd = readString(style.fill_gradient_end);
  const legacyAngle = readString(style.fill_gradient_angle_deg);
  const objectStart = readString(gradientObject?.start_color);
  const objectEnd = readString(gradientObject?.end_color);
  const objectAngle = readString(gradientObject?.angle_deg);

  const startColor = normalizeColor(
    objectStart || legacyStart,
    DEFAULT_GRADIENT_START_COLOR
  );
  const endColor = normalizeColor(objectEnd || legacyEnd, DEFAULT_GRADIENT_END_COLOR);
  const angleDeg = normalizeAngle(
    objectAngle || legacyAngle,
    DEFAULT_GRADIENT_ANGLE_DEG
  );

  const fillGradientRaw = style.fill_gradient;
  let enabled = false;
  if (typeof fillGradientRaw === "boolean") {
    enabled = fillGradientRaw;
  } else if (gradientObject) {
    enabled = true;
  } else {
    enabled = legacyStart.length > 0 || legacyEnd.length > 0;
  }

  return {
    enabled,
    startColor,
    endColor,
    angleDeg,
  };
}

function hasGradientFields(style: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(style, "fill_gradient") ||
    Object.prototype.hasOwnProperty.call(style, "fill_gradient_start") ||
    Object.prototype.hasOwnProperty.call(style, "fill_gradient_end") ||
    Object.prototype.hasOwnProperty.call(style, "fill_gradient_angle_deg")
  );
}

export function buildShapeGradientStylePatch(
  style: Record<string, unknown>,
  input: ShapeGradientPatchInput
): Record<string, unknown> {
  const current = resolveShapeGradientState(style);
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const startColor = normalizeColor(
    typeof input.startColor === "string" ? input.startColor : current.startColor,
    DEFAULT_GRADIENT_START_COLOR
  );
  const endColor = normalizeColor(
    typeof input.endColor === "string" ? input.endColor : current.endColor,
    DEFAULT_GRADIENT_END_COLOR
  );
  const angleDeg = normalizeAngle(
    typeof input.angleDeg === "string" ? input.angleDeg : current.angleDeg,
    DEFAULT_GRADIENT_ANGLE_DEG
  );
  return {
    fill_gradient: enabled
      ? {
          start_color: startColor,
          end_color: endColor,
          angle_deg: angleDeg,
        }
      : false,
    fill_gradient_start: startColor,
    fill_gradient_end: endColor,
    fill_gradient_angle_deg: angleDeg,
  };
}

export function normalizeShapeGradientStyleForSave(
  style: Record<string, unknown>
): Record<string, unknown> {
  const nextStyle = { ...style };
  const hasFillGradient = Object.prototype.hasOwnProperty.call(nextStyle, "fill_gradient");
  const hasLegacyStart = Object.prototype.hasOwnProperty.call(nextStyle, "fill_gradient_start");
  const hasLegacyEnd = Object.prototype.hasOwnProperty.call(nextStyle, "fill_gradient_end");
  const hasLegacyAngle = Object.prototype.hasOwnProperty.call(nextStyle, "fill_gradient_angle_deg");
  if (!hasGradientFields(nextStyle)) {
    return nextStyle;
  }
  const fillGradientRaw = nextStyle.fill_gradient;
  if (
    typeof fillGradientRaw !== "undefined" &&
    typeof fillGradientRaw !== "boolean" &&
    !isPlainObject(fillGradientRaw)
  ) {
    return nextStyle;
  }
  if (
    hasFillGradient &&
    fillGradientRaw === false &&
    !hasLegacyStart &&
    !hasLegacyEnd &&
    !hasLegacyAngle
  ) {
    return nextStyle;
  }
  const patch = buildShapeGradientStylePatch(nextStyle, {});
  return {
    ...nextStyle,
    ...patch,
  };
}
