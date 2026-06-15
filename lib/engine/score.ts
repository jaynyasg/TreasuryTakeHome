import {
  ColaApplication,
  ExtractedLabel,
  FieldKey,
  FieldVerdict,
  MatchReport,
} from "@/lib/contract";
import {
  compareAlcoholContent,
  compareNetContents,
  compareProducerAddress,
  compareText,
  parseAlcoholContent,
} from "./normalize";
import { checkGovernmentWarning } from "./warning";

type TextComparisonKind = "exact" | "close" | "different";

function verdictFromComparison(
  field: FieldKey,
  applicationValue: string,
  labelValue: string,
  kind: TextComparisonKind,
  reason: string
): FieldVerdict {
  const status =
    kind === "exact" ? "match" : kind === "close" ? "close_match" : "mismatch";
  return { field, status, applicationValue, labelValue, reason };
}

/** Required-by-application field absent from the label. */
function absentVerdict(
  field: FieldKey,
  applicationValue: string,
  readability: ExtractedLabel["readability"],
  what: string
): FieldVerdict {
  if (readability !== "clear") {
    return {
      field,
      status: "needs_review",
      applicationValue,
      labelValue: null,
      reason: `Could not read ${what} from the label image (image is ${readability}). An agent should review the original.`,
    };
  }
  return {
    field,
    status: "missing_on_label",
    applicationValue,
    labelValue: null,
    reason: `${what} appears on the application but was not found on the label.`,
  };
}

function notApplicable(field: FieldKey, why: string): FieldVerdict {
  return {
    field,
    status: "not_applicable",
    applicationValue: null,
    labelValue: null,
    reason: why,
  };
}

function shouldRouteAlcoholOcrAmbiguityToReview(
  app: ColaApplication,
  label: ExtractedLabel
): boolean {
  if (app.beverageType !== "wine" || !app.wineAppellation || !app.wineVintage) return false;
  if (!label.brandName || !label.classType || !label.wineAppellation || !label.wineVintage) return false;

  const appAlcohol = parseAlcoholContent(app.alcoholContent ?? "");
  const labelAlcohol = parseAlcoholContent(label.alcoholContent ?? "");
  if (appAlcohol.percent === null || labelAlcohol.percent === null) return false;
  if (Math.abs(appAlcohol.percent - labelAlcohol.percent) > 2.5) return false;

  const matchingIdentity =
    compareText(app.brandName, label.brandName).kind !== "different" &&
    compareText(app.classType, label.classType).kind !== "different" &&
    compareText(app.wineAppellation, label.wineAppellation).kind !== "different" &&
    compareText(app.wineVintage, label.wineVintage).kind !== "different";

  return matchingIdentity;
}

/**
 * The core matching oracle: pure function from (application, extracted label)
 * to a per-field report with reasons and an overall match percentage.
 */
export function buildMatchReport(
  app: ColaApplication,
  label: ExtractedLabel
): MatchReport {
  const verdicts: FieldVerdict[] = [];
  const r = label.readability;

  // Brand name — required always.
  verdicts.push(
    label.brandName === null
      ? absentVerdict("brandName", app.brandName, r, "the brand name")
      : (() => {
          const c = compareText(app.brandName, label.brandName);
          return verdictFromComparison("brandName", app.brandName, label.brandName, c.kind, c.reason);
        })()
  );

  // Fanciful name — only if the application declares one.
  if (app.fancifulName) {
    verdicts.push(
      label.fancifulName === null
        ? absentVerdict("fancifulName", app.fancifulName, r, "the fanciful name")
        : (() => {
            const c = compareText(app.fancifulName!, label.fancifulName!);
            return verdictFromComparison("fancifulName", app.fancifulName!, label.fancifulName!, c.kind, c.reason);
          })()
    );
  } else {
    verdicts.push(notApplicable("fancifulName", "No fanciful name on the application."));
  }

  // Class/type — required always.
  verdicts.push(
    label.classType === null
      ? absentVerdict("classType", app.classType, r, "the class/type designation")
      : (() => {
          const c = compareText(app.classType, label.classType);
          return verdictFromComparison("classType", app.classType, label.classType, c.kind, c.reason);
        })()
  );

  // Alcohol content. 2009-edition applications state it (match values);
  // 2023-edition forms dropped the box, so we verify label PRESENCE per
  // 27 CFR instead (mandatory for wine/spirits; optional for malt beverages).
  if (app.alcoholContent === undefined) {
    if (label.alcoholContent !== null) {
      verdicts.push({
        field: "alcoholContent",
        status: "match",
        applicationValue: null,
        labelValue: label.alcoholContent,
        reason:
          "No expected value on the application (2023-edition form omits it); label states an alcohol content — presence verified.",
      });
    } else if (app.beverageType === "malt_beverage") {
      verdicts.push(
        notApplicable(
          "alcoholContent",
          "Not on the application (2023-edition form) and optional on malt beverage labels federally."
        )
      );
    } else {
      verdicts.push(absentVerdict("alcoholContent", "(required on label)", r, "the alcohol content"));
    }
  } else {
    verdicts.push(
      label.alcoholContent === null
        ? absentVerdict("alcoholContent", app.alcoholContent, r, "the alcohol content")
        : (() => {
            const c = compareAlcoholContent(app.alcoholContent, label.alcoholContent);
            if (!c.equivalent && shouldRouteAlcoholOcrAmbiguityToReview(app, label)) {
              return {
                field: "alcoholContent" as const,
                status: "needs_review" as const,
                applicationValue: app.alcoholContent,
                labelValue: label.alcoholContent,
                reason:
                  `${c.reason} The rest of this wine identity (brand, class/type, appellation, and vintage) matches, so this small numeric difference may be an OCR read of degraded label text; route to an agent before rejecting.`,
              };
            }
            return {
              field: "alcoholContent" as const,
              status: c.equivalent
                ? app.alcoholContent === label.alcoholContent
                  ? ("match" as const)
                  : ("close_match" as const)
                : ("mismatch" as const),
              applicationValue: app.alcoholContent,
              labelValue: label.alcoholContent,
              reason: c.reason,
            };
          })()
    );
  }

  // Net contents — same two-edition handling; mandatory on every label.
  if (app.netContents === undefined) {
    if (label.netContents !== null) {
      verdicts.push({
        field: "netContents",
        status: "match",
        applicationValue: null,
        labelValue: label.netContents,
        reason:
          "No expected value on the application (2023-edition form omits it); label states net contents — presence verified.",
      });
    } else {
      verdicts.push(absentVerdict("netContents", "(required on label)", r, "the net contents"));
    }
  } else {
    verdicts.push(
      label.netContents === null
        ? absentVerdict("netContents", app.netContents, r, "the net contents")
        : (() => {
            const c = compareNetContents(app.netContents, label.netContents);
            return {
              field: "netContents" as const,
              status: c.equivalent
                ? app.netContents === label.netContents
                  ? ("match" as const)
                  : ("close_match" as const)
                : ("mismatch" as const),
              applicationValue: app.netContents,
              labelValue: label.netContents,
              reason: c.reason,
            };
          })()
    );
  }

  // Producer name & address.
  verdicts.push(
    label.producerNameAddress === null
      ? absentVerdict("producerNameAddress", app.applicantNameAddress, r, "the bottler/producer name and address")
      : (() => {
          const c = compareProducerAddress(app.applicantNameAddress, label.producerNameAddress!);
          return verdictFromComparison(
            "producerNameAddress",
            app.applicantNameAddress,
            label.producerNameAddress!,
            c.kind,
            c.reason
          );
        })()
  );

  // Country of origin — required for imports only.
  if (app.sourceOfProduct === "imported") {
    const expected = app.countryOfOrigin ?? "country of origin statement";
    verdicts.push(
      label.countryOfOrigin === null
        ? absentVerdict("countryOfOrigin", expected, r, "the country of origin (required for imports)")
        : (() => {
            const c = compareText(expected, label.countryOfOrigin!);
            return verdictFromComparison("countryOfOrigin", expected, label.countryOfOrigin!, c.kind, c.reason);
          })()
    );
  } else {
    verdicts.push(notApplicable("countryOfOrigin", "Domestic product — no country of origin required."));
  }

  // Wine-only fields, and only when declared on the application.
  for (const [field, appValue, what] of [
    ["wineAppellation", app.wineAppellation, "the wine appellation"],
    ["wineVintage", app.wineVintage, "the vintage date"],
  ] as const) {
    if (app.beverageType === "wine" && appValue) {
      verdicts.push(
        label[field] === null
          ? absentVerdict(field, appValue, r, what)
          : (() => {
              const c = compareText(appValue, label[field]!);
              return verdictFromComparison(field, appValue, label[field]!, c.kind, c.reason);
            })()
      );
    } else {
      verdicts.push(
        notApplicable(
          field,
          app.beverageType === "wine"
            ? `Not declared on the application.`
            : `Not applicable to ${app.beverageType.replace("_", " ")}.`
        )
      );
    }
  }

  // Grape varietals — 2023-edition item 10 (wine only). The varietal appears
  // on the label as (part of) the class/type or fanciful text, so we check
  // containment there rather than asking the extractor for a new field.
  if (app.beverageType === "wine" && app.grapeVarietals) {
    const labelText = [label.classType, label.fancifulName].filter(Boolean).join(" ");
    if (!labelText) {
      verdicts.push(absentVerdict("grapeVarietals", app.grapeVarietals, r, "the grape varietal(s)"));
    } else {
      const declared = app.grapeVarietals
        .split(/,|\band\b|;/i)
        .map((v) => v.trim())
        .filter(Boolean);
      const missing = declared.filter(
        (v) => !labelText.toLowerCase().includes(v.toLowerCase())
      );
      verdicts.push({
        field: "grapeVarietals",
        status: missing.length === 0 ? "match" : "mismatch",
        applicationValue: app.grapeVarietals,
        labelValue: labelText,
        reason:
          missing.length === 0
            ? "All declared grape varietals appear on the label."
            : `Declared varietal(s) not found on the label: ${missing.join(", ")}.`,
      });
    }
  } else {
    verdicts.push(
      notApplicable(
        "grapeVarietals",
        app.beverageType === "wine"
          ? "No grape varietals declared on the application."
          : `Not applicable to ${app.beverageType.replace("_", " ")}.`
      )
    );
  }

  // Government warning — required always, exact.
  verdicts.push(checkGovernmentWarning(label.governmentWarning));

  const applicable = verdicts.filter((v) => v.status !== "not_applicable");
  const matched = applicable.filter(
    (v) => v.status === "match" || v.status === "close_match"
  );
  const matchPercentage = applicable.length
    ? Math.round((matched.length / applicable.length) * 100)
    : 100;

  const hasProblems = applicable.some(
    (v) => v.status === "mismatch" || v.status === "missing_on_label"
  );
  const needsReview = applicable.some((v) => v.status === "needs_review");
  const overall = hasProblems ? "has_mismatches" : needsReview ? "needs_review" : "all_match";

  const problemFields = applicable
    .filter((v) => v.status !== "match" && v.status !== "close_match")
    .map((v) => v.field);
  const summary =
    overall === "all_match"
      ? `All ${applicable.length} checked fields are consistent with the application.`
      : overall === "needs_review"
        ? `${matched.length}/${applicable.length} fields verified; agent review needed for: ${problemFields.join(", ")}.`
        : `${matched.length}/${applicable.length} fields match; issues with: ${problemFields.join(", ")}.`;

  return { matchPercentage, verdicts, overall, summary };
}
