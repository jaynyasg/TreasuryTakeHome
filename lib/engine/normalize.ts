/**
 * Pure normalization + comparison primitives. No I/O, no LLM.
 * These encode the "judgment" tier Dave asked for: formatting differences
 * are equivalences with explanations, not mismatches.
 */

const APOSTROPHES = /[‘’ʼ`]/g;
const QUOTES = /[“”]/g;
const DASHES = /[–—]/g;

/** Unicode punctuation variants → ASCII; collapse whitespace. */
export function canonText(s: string): string {
  return s
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPunct(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export type TextComparison =
  | { kind: "exact"; reason: string }
  | { kind: "close"; reason: string }
  | { kind: "different"; reason: string };

export function compareText(application: string, label: string): TextComparison {
  if (application.trim() === label.trim()) {
    return { kind: "exact", reason: "Exact match." };
  }
  const a = canonText(application);
  const b = canonText(label);
  if (a === b) {
    return {
      kind: "close",
      reason: `Differs only in punctuation or spacing ("${application}" vs "${label}") — same name.`,
    };
  }
  if (a.toLowerCase() === b.toLowerCase()) {
    return {
      kind: "close",
      reason: `Differs only in capitalization ("${application}" vs "${label}") — same name.`,
    };
  }
  if (stripPunct(a.toLowerCase()) === stripPunct(b.toLowerCase())) {
    return {
      kind: "close",
      reason: `Differs only in punctuation or spacing ("${application}" vs "${label}") — same name.`,
    };
  }
  return {
    kind: "different",
    reason: `Application says "${application}" but the label shows "${label}".`,
  };
}

export interface AlcoholContent {
  percent: number | null;
  proof: number | null;
}

/** Parse "45% Alc./Vol. (90 Proof)", "12", "ALC. 13.5% BY VOL." */
export function parseAlcoholContent(s: string): AlcoholContent {
  const text = canonText(s);
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const proofMatch = text.match(/(\d+(?:\.\d+)?)\s*proof/i);
  let percent = pctMatch ? Number(pctMatch[1]) : null;
  if (percent === null) {
    // A bare number on the form (e.g. "12") means percent alc/vol.
    const bare = text.match(/^(\d+(?:\.\d+)?)$/);
    if (bare) percent = Number(bare[1]);
  }
  return { percent, proof: proofMatch ? Number(proofMatch[1]) : null };
}

export interface ValueComparison {
  equivalent: boolean;
  reason: string;
}

export function compareAlcoholContent(application: string, label: string): ValueComparison {
  const a = parseAlcoholContent(application);
  const b = parseAlcoholContent(label);
  if (a.percent === null || b.percent === null) {
    return {
      equivalent: false,
      reason: `Could not read an alcohol percentage from ${a.percent === null ? `application value "${application}"` : `label value "${label}"`}.`,
    };
  }
  if (Math.abs(a.percent - b.percent) > 0.001) {
    return {
      equivalent: false,
      reason: `Application states ${a.percent}% alc/vol but the label shows ${b.percent}%.`,
    };
  }
  for (const [side, v] of [["application", a], ["label", b]] as const) {
    if (v.proof !== null && Math.abs(v.proof - v.percent! * 2) > 0.001) {
      return {
        equivalent: false,
        reason: `The ${side} proof (${v.proof}) is inconsistent with ${v.percent}% alc/vol (expected ${v.percent! * 2} proof).`,
      };
    }
  }
  if (a.proof !== null && b.proof !== null && Math.abs(a.proof - b.proof) > 0.001) {
    return {
      equivalent: false,
      reason: `Application proof (${a.proof}) differs from label proof (${b.proof}).`,
    };
  }
  return {
    equivalent: true,
    reason: `Both state ${a.percent}% alc/vol${a.proof ?? b.proof ? ` (${a.proof ?? b.proof} proof)` : ""}; formatting differences only.`,
  };
}

const UNIT_TO_ML: Array<[RegExp, number]> = [
  [/milliliters?|millilitres?|ml/i, 1],
  [/centiliters?|centilitres?|cl/i, 10],
  [/liters?|litres?|l/i, 1000],
  [/fl\.?\s*oz|fluid\s+ounces?/i, 29.5735],
];

export function parseNetContents(s: string): { ml: number | null } {
  const text = canonText(s);
  const m = text.match(/(\d+(?:\.\d+)?)\s*([a-z.\s]+)/i);
  if (!m) return { ml: null };
  const qty = Number(m[1]);
  const unit = m[2].trim();
  for (const [re, factor] of UNIT_TO_ML) {
    if (re.test(unit)) return { ml: Math.round(qty * factor * 100) / 100 };
  }
  return { ml: null };
}

export function compareNetContents(application: string, label: string): ValueComparison {
  const a = parseNetContents(application);
  const b = parseNetContents(label);
  if (a.ml === null || b.ml === null) {
    return {
      equivalent: false,
      reason: `Could not parse net contents from ${a.ml === null ? `application value "${application}"` : `label value "${label}"`}.`,
    };
  }
  if (Math.abs(a.ml - b.ml) > 0.01) {
    return {
      equivalent: false,
      reason: `Application states ${a.ml} mL but the label shows ${b.ml} mL.`,
    };
  }
  return { equivalent: true, reason: `Both equal ${a.ml} mL; unit formatting differs only.` };
}

/** "PRODUCED & BOTTLED BY" etc. — statement boilerplate, not identity. */
const PRODUCER_BOILERPLATE =
  /\b(produced|bottled|distilled|brewed|vinted|cellared|made|imported|blended)\b|&|\band\b|\bby\b/gi;

const STATE_ABBREV: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

function addressTokens(s: string): string[] {
  const cleaned = stripPunct(
    canonText(s).toLowerCase().replace(PRODUCER_BOILERPLATE, " ")
  );
  return cleaned
    .split(" ")
    .filter(Boolean)
    .flatMap((t) => (STATE_ABBREV[t] ? STATE_ABBREV[t].split(" ") : [t]));
}

/**
 * Address consistency: COLA forms carry a full registered address while labels
 * typically print "PRODUCED & BOTTLED BY <name>, <city>, <state>". The label
 * is consistent if its identifying words all appear in the application's
 * address (boilerplate stripped, state abbreviations expanded).
 */
export function compareProducerAddress(application: string, label: string): TextComparison {
  const appTokens = new Set(addressTokens(application));
  const labelTokens = addressTokens(label);
  const missing = labelTokens.filter((t) => !appTokens.has(t));
  if (missing.length === 0) {
    return {
      kind: canonText(application) === canonText(label) ? "exact" : "close",
      reason: "Label producer/address is consistent with the applicant's registered name and address.",
    };
  }
  if (missing.length <= Math.ceil(labelTokens.length * 0.3)) {
    return {
      kind: "close",
      reason: `Label address mostly matches the application; extra label words: ${missing.join(", ")}.`,
    };
  }
  return {
    kind: "different",
    reason: `Label producer "${label}" does not correspond to the applicant "${application}".`,
  };
}
