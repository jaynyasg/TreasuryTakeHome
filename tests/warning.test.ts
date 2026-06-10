import { describe, expect, it } from "vitest";
import { checkGovernmentWarning } from "@/lib/engine/warning";
import {
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";

const exact = {
  present: true,
  text: `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`,
  headingStyle: "all_caps" as const,
};

describe("government warning checker (C1)", () => {
  it("passes the exact warning with all-caps heading", () => {
    const v = checkGovernmentWarning(exact);
    expect(v.status).toBe("match");
  });

  it("passes when the body is printed in all caps (case-insensitive body)", () => {
    const v = checkGovernmentWarning({
      ...exact,
      text: `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY.toUpperCase()}`,
    });
    expect(v.status).toBe("match");
  });

  it("passes with collapsed/extra whitespace and line breaks", () => {
    const v = checkGovernmentWarning({
      ...exact,
      text: `${GOVERNMENT_WARNING_HEADING}  (1) According to the Surgeon General,\nwomen should not drink alcoholic beverages during pregnancy because of the risk of birth defects.\n(2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`,
    });
    expect(v.status).toBe("match");
  });

  it("rejects a title-case heading (Jenny's catch)", () => {
    const v = checkGovernmentWarning({
      ...exact,
      text: `Government Warning: ${GOVERNMENT_WARNING_BODY}`,
      headingStyle: "title_case",
    });
    expect(v.status).toBe("mismatch");
    expect(v.reason.toLowerCase()).toContain("caps");
  });

  it("rejects reworded body text", () => {
    const v = checkGovernmentWarning({
      ...exact,
      text: `${GOVERNMENT_WARNING_HEADING} (1) Per the Surgeon General, pregnant women shouldn't drink. (2) Alcohol impairs driving.`,
    });
    expect(v.status).toBe("mismatch");
    expect(v.reason.toLowerCase()).toContain("word-for-word");
  });

  it("rejects omitted words even when most of the text is right", () => {
    const v = checkGovernmentWarning({
      ...exact,
      // "of birth defects" dropped
      text: `${GOVERNMENT_WARNING_HEADING} (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`,
    });
    expect(v.status).toBe("mismatch");
  });

  it("flags a missing warning as missing_on_label", () => {
    const v = checkGovernmentWarning({ present: false, text: null, headingStyle: null });
    expect(v.status).toBe("missing_on_label");
  });
});
