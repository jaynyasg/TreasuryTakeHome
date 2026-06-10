import {
  ExtractedLabel,
  FieldVerdict,
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";
import { canonText } from "./normalize";

const EXPECTED_FULL = `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`;

/**
 * 27 CFR Part 16: the health warning must appear word-for-word, with the
 * "GOVERNMENT WARNING:" lead-in in capital letters (and bold — typography is
 * verified visually by the extractor's headingStyle judgment).
 *
 * Body case is not regulated (labels commonly print it in all caps), so the
 * body comparison is case-insensitive; the wording itself must be exact.
 */
export function checkGovernmentWarning(
  gw: ExtractedLabel["governmentWarning"]
): FieldVerdict {
  const base = {
    field: "governmentWarning" as const,
    applicationValue: EXPECTED_FULL,
    labelValue: gw.text,
  };

  if (!gw.present || !gw.text) {
    return {
      ...base,
      status: "missing_on_label",
      reason:
        "The mandatory Government Health Warning Statement is not on the label. It is required on all alcoholic beverages.",
    };
  }

  const text = canonText(gw.text);

  // Locate the heading case-insensitively, then verify its actual casing.
  const headingIdx = text.toLowerCase().indexOf(GOVERNMENT_WARNING_HEADING.toLowerCase());
  if (headingIdx === -1) {
    return {
      ...base,
      status: "mismatch",
      reason:
        'The warning does not begin with the required "GOVERNMENT WARNING:" lead-in.',
    };
  }
  const actualHeading = text.slice(headingIdx, headingIdx + GOVERNMENT_WARNING_HEADING.length);
  if (actualHeading !== GOVERNMENT_WARNING_HEADING || gw.headingStyle !== "all_caps") {
    return {
      ...base,
      status: "mismatch",
      reason: `"${actualHeading}" must appear in all caps (and bold) as "GOVERNMENT WARNING:".`,
    };
  }

  const body = text.slice(headingIdx + GOVERNMENT_WARNING_HEADING.length).trim();
  if (body.toLowerCase() !== GOVERNMENT_WARNING_BODY.toLowerCase()) {
    return {
      ...base,
      status: "mismatch",
      reason:
        "The warning text deviates from the mandatory statement — it must match word-for-word (27 CFR Part 16).",
    };
  }

  return {
    ...base,
    status: "match",
    reason: "Required warning present, word-for-word, with all-caps lead-in.",
  };
}
