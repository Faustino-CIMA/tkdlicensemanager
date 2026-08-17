import {
  buildShapeGradientStylePatch,
  normalizeShapeGradientStyleForSave,
  resolveShapeGradientState,
} from "./license-card-gradient";

describe("license-card-gradient helpers", () => {
  it("resolves legacy boolean false as disabled without losing values", () => {
    const state = resolveShapeGradientState({
      fill_gradient: false,
      fill_gradient_start: "#f97316",
      fill_gradient_end: "#22c55e",
      fill_gradient_angle_deg: "120",
    });
    expect(state.enabled).toBe(false);
    expect(state.startColor).toBe("#f97316");
    expect(state.endColor).toBe("#22c55e");
    expect(state.angleDeg).toBe("120");
  });

  it("builds canonical style patch and keeps values on toggle round-trip", () => {
    const baseStyle = {};
    const enabledPatch = buildShapeGradientStylePatch(baseStyle, { enabled: true });
    expect(enabledPatch.fill_gradient).toEqual({
      start_color: "#ef4444",
      end_color: "#3b82f6",
      angle_deg: "90",
    });

    const customEnabledPatch = buildShapeGradientStylePatch(
      { ...baseStyle, ...enabledPatch },
      {
        startColor: "#111111",
        endColor: "#999999",
        angleDeg: "33",
      }
    );
    const disabledPatch = buildShapeGradientStylePatch(
      { ...baseStyle, ...customEnabledPatch },
      { enabled: false }
    );
    expect(disabledPatch.fill_gradient).toBe(false);
    expect(disabledPatch.fill_gradient_start).toBe("#111111");
    expect(disabledPatch.fill_gradient_end).toBe("#999999");
    expect(disabledPatch.fill_gradient_angle_deg).toBe("33");
  });

  it("normalizes legacy boolean+keys to canonical gradient object for save", () => {
    const normalized = normalizeShapeGradientStyleForSave({
      shape_kind: "rectangle",
      fill_gradient: true,
      fill_gradient_start: "#06b6d4",
      fill_gradient_end: "#9333ea",
      fill_gradient_angle_deg: "145",
    });
    expect(normalized.fill_gradient).toEqual({
      start_color: "#06b6d4",
      end_color: "#9333ea",
      angle_deg: "145",
    });
  });

  it("keeps non-gradient styles unchanged on save normalization", () => {
    const style = {
      shape_kind: "rectangle",
      fill_color: "#e2e8f0",
      border_radius_mm: "1.00",
    };
    expect(normalizeShapeGradientStyleForSave(style)).toEqual(style);
  });
});
