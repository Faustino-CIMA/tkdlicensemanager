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
    expect(srcDoc).toContain("-webkit-text-size-adjust:none");
  });

  it("renders a 2x backing store for retina display", () => {
    const payload = buildSimulationPayload();
    const layout = calculateCardSimulationFrameLayout(payload);
    const srcDoc = buildCardSimulationSrcDoc(payload, { pixelRatio: 2 });

    expect(srcDoc).toContain(`width:${layout.renderedWidthPx * 2}px`);
    expect(srcDoc).toContain("transform:scale(1.500000)");
  });

  it("fills a target display width so the CSS-mm canvas matches the iframe", () => {
    const payload = buildSimulationPayload();
    const layout = calculateCardSimulationFrameLayout(payload);
    const srcDoc = buildCardSimulationSrcDoc(payload, { targetWidthPx: 420 });
    const expectedScale = 420 / layout.renderedWidthPx;

    expect(srcDoc).toContain("width:420px");
    expect(srcDoc).toContain(`width:${layout.renderedWidthPx}px`);
    expect(srcDoc).toContain(`transform:scale(${expectedScale.toFixed(6)})`);
    expect(srcDoc).not.toContain("transform:scale(0.750000)");
  });

  it("matches browser PDF preview point scale", () => {
    const payload = buildSimulationPayload();

    const layout = calculateCardSimulationFrameLayout(payload);
    const expectedNaturalWidthPx = ((85 * 96) / 25.4) * (96 / 72);
    const expectedNaturalHeightPx = ((55 * 96) / 25.4) * (96 / 72);
    const expectedRenderedWidthPx = (85 * 96) / 25.4;
    const expectedRenderedHeightPx = (55 * 96) / 25.4;

    expect(layout.naturalWidthPx).toBeCloseTo(expectedNaturalWidthPx, 6);
    expect(layout.naturalHeightPx).toBeCloseTo(expectedNaturalHeightPx, 6);
    expect(layout.scale).toBeCloseTo(72 / 96, 6);
    expect(layout.renderedWidthPx).toBeCloseTo(expectedRenderedWidthPx, 6);
    expect(layout.renderedHeightPx).toBeCloseTo(expectedRenderedHeightPx, 6);
  });

  it("uses safe fallbacks for empty payload values", () => {
    const layout = calculateCardSimulationFrameLayout(null);
    const expectedNaturalWidthPx = ((85 * 96) / 25.4) * (96 / 72);
    const expectedNaturalHeightPx = ((55 * 96) / 25.4) * (96 / 72);
    const expectedRenderedWidthPx = (85 * 96) / 25.4;
    const expectedRenderedHeightPx = (55 * 96) / 25.4;

    expect(layout.naturalWidthPx).toBeCloseTo(expectedNaturalWidthPx, 6);
    expect(layout.naturalHeightPx).toBeCloseTo(expectedNaturalHeightPx, 6);
    expect(layout.scale).toBeCloseTo(72 / 96, 6);
    expect(layout.renderedWidthPx).toBeCloseTo(expectedRenderedWidthPx, 6);
    expect(layout.renderedHeightPx).toBeCloseTo(expectedRenderedHeightPx, 6);
    expect(buildCardSimulationSrcDoc(null)).toBe("");
  });

  it("keeps full SVG data URI intact in iframe srcDoc", () => {
    const longSvgDataUri =
      "data:image/svg+xml;base64," + "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmMDAwMCIvPjwvc3ZnPg==".repeat(8);
    const payload = buildSimulationPayload({
      html: `<div class="card-canvas"><img src="${longSvgDataUri}" alt="" /></div>`,
    });

    const srcDoc = buildCardSimulationSrcDoc(payload);

    expect(srcDoc).toContain(longSvgDataUri);
    expect(srcDoc.indexOf(longSvgDataUri)).toBe(srcDoc.lastIndexOf(longSvgDataUri));
  });
});
