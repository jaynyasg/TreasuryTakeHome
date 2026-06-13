import {
  ExtractedLabel,
  FieldVerdict,
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";
import { canonText } from "./normalize";

const EXPECTED_FULL = `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`;

/**
 * Below this model-reported confidence, an otherwise word-for-word, all-caps
 * GOVERNMENT WARNING whose lead-in boldness the model could NOT confirm is
 * routed to needs_review (with visual evidence) instead of a false match.
 *
 * Chosen at 0.6: the regulation requires a bold lead-in (27 CFR Part 16), but
 * boldness is a visual judgment a vision model cannot always make on imperfect
 * images (R11). 0.6 keeps confident reads (>=0.6) flowing as `match` while
 * routing genuine uncertainty to a human — erring toward review, never toward a
 * silent false pass or a false rejection of correct wording. The field is
 * optional, so legacy data without a confidence is unaffected (still `match`).
 */
export const WARNING_BOLDNESS_THRESHOLD = 0.6;

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

  // Wording + capitalization are correct. Before declaring `match`, honor the
  // hybrid typography signal: if the model SUPPLIED a boldness confidence and it
  // is below the threshold, the lead-in may not actually be bold (27 CFR Part 16
  // requires bold) — route to needs_review with evidence rather than a false
  // pass. When the field is absent/null/undefined (all legacy extractions), this
  // branch never fires and the verdict stays `match`, exactly as before.
  const conf = gw.boldnessConfidence;
  if (typeof conf === "number" && conf < WARNING_BOLDNESS_THRESHOLD) {
    return {
      ...base,
      status: "needs_review",
      reason: `Wording and capitalization are correct, but the model could not confirm the "${GOVERNMENT_WARNING_HEADING}" lead-in is bold (confidence ${conf}) — routed for human review.`,
    };
  }

  return {
    ...base,
    status: "match",
    reason: "Required warning present, word-for-word, with all-caps lead-in.",
  };
}
