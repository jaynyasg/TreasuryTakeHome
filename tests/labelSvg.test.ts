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
});
