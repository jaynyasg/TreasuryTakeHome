import { describe, expect, it } from "vitest";
import { GOVERNMENT_WARNING_HEADING } from "@/lib/contract";
import { generateCase } from "@/lib/engine/generator";
import { renderLabelSvg } from "@/lib/labelSvg";

describe("label SVG renderer", () => {
  it("uses beverage-specific label templates", () => {
    const templates = {
      wine: "wine-estate",
      distilled_spirits: "spirits-poster",
      malt_beverage: "brewery-badge",
    } as const;

    for (const [beverageType, template] of Object.entries(templates)) {
      const c = generateCase(4, { defects: 0, beverageType: beverageType as keyof typeof templates });
      const svg = renderLabelSvg(c, 4);

      expect(svg).toContain(`data-template="${template}"`);
      for (const word of c.label.classType!.toUpperCase().split(/\s+/)) {
        expect(svg.toUpperCase()).toContain(word);
      }
      expect(svg).toContain(GOVERNMENT_WARNING_HEADING);
      expect(svg).not.toContain("undefined");
    }
  });

  it("escapes generated label text before embedding it in SVG", () => {
    const c = generateCase(8, { defects: 0, beverageType: "malt_beverage" });
    c.label.brandName = "FOUNDRY & OAK <PRIVATE>";

    const svg = renderLabelSvg(c, 8);

    expect(svg).toContain("FOUNDRY &amp; OAK");
    expect(svg).toContain("&lt;PRIVATE&gt;");
    expect(svg).not.toContain("FOUNDRY & OAK <PRIVATE>");
  });

  it("keeps the brewery class/type plate explicit and unobstructed for failed live-batch seeds", () => {
    for (const seed of [34, 37, 49, 52, 85, 232, 259, 292, 301]) {
      const c = generateCase(seed, { defects: 0 });
      const svg = renderLabelSvg(c, seed);

      expect(svg).toContain('data-template="brewery-badge"');
      expect(svg).toContain(">CLASS / TYPE<");
      expect(svg).toContain(`>${c.label.classType!.toUpperCase()}<`);
      expect(svg).not.toContain("M240 211 V438");
      expect(svg).not.toContain("M146 334 C174 286");
      expect(svg).not.toContain('stroke-dasharray="8 7"');
    }
  });

  it("renders spirits warning defects horizontally instead of in a rotated rail", () => {
    const c = generateCase(42, { defects: 2 });
    const svg = renderLabelSvg(c, 42);

    expect(svg).toContain('data-template="spirits-poster"');
    expect(svg).toContain("GOVERNMENT WARNING:");
    expect(svg).toContain("Per the Surgeon General");
    expect(svg).not.toContain("rotate(-90)");
  });
});
