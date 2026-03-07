import type { CardPreviewHtmlResponse } from "@/lib/license-card-api";

import {
  buildCardSimulationSrcDoc,
  calculateCardSimulationFrameLayout,
} from "@/lib/card-simulation";

function buildSimulationPayload(overrides?: Partial<CardPreviewHtmlResponse>): CardPreviewHtmlResponse {
  return {
    template_version_id: 23,
    template_id: 11,
    active_side: "front",
    available_sides: ["front", "back"],
    side_summary: {},
    card_format: {
      id: 1,
      code: "3c",
      name: "3C",
      width_mm: "85.00",
      height_mm: "55.00",
    },
    html: '<div class="card-canvas">SIM</div>',
    css: "html,body{margin:0;padding:0;}.card-canvas{width:85.00mm;height:55.00mm;}",
    ...overrides,
  };
}

describe("card simulation utilities", () => {
  it("builds scaled srcDoc from backend canonical html/css", () => {
    const payload = buildSimulationPayload();

    const srcDoc = buildCardSimulationSrcDoc(payload);

    expect(srcDoc).toContain(payload.css);
    expect(srcDoc).toContain(payload.html);
    expect(srcDoc).not.toContain("--card-simulation-scale");
    expect(srcDoc).toContain("#card-simulation-root");
    expect(srcDoc).toContain("transform:scale(0.750000)");
  });

  it("matches browser PDF preview point scale", () => {
    const payload = buildSimulationPayload();

    const layout = calculateCardSimulationFrameLayout(payload);

    expect(layout.naturalWidthPx).toBeCloseTo((85 * 96) / 25.4, 6);
    expect(layout.naturalHeightPx).toBeCloseTo((55 * 96) / 25.4, 6);
    expect(layout.scale).toBeCloseTo(72 / 96, 6);
    expect(layout.renderedWidthPx).toBeCloseTo(layout.naturalWidthPx * layout.scale, 6);
    expect(layout.renderedHeightPx).toBeCloseTo(layout.naturalHeightPx * layout.scale, 6);
  });

  it("uses safe fallbacks for empty payload values", () => {
    const layout = calculateCardSimulationFrameLayout(null);

    expect(layout.naturalWidthPx).toBeCloseTo((85 * 96) / 25.4, 6);
    expect(layout.naturalHeightPx).toBeCloseTo((55 * 96) / 25.4, 6);
    expect(layout.scale).toBeCloseTo(72 / 96, 6);
    expect(buildCardSimulationSrcDoc(null)).toBe("");
  });
});
