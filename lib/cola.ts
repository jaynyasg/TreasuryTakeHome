import { ColaApplication } from "@/lib/contract";

/**
 * Parser for the public COLA registry detail page
 * (ttbonline.gov viewColaDetails.do — TTB Form 5100.31 rendered as a JSP table).
 * Developed and unit-tested against a committed HTML fixture so the offline
 * gate proves it without touching the live site. Read-only reference-data
 * lookup; not COLA *system* integration (no auth, no writes — see plan AC-2).
 */

export class ColaParseError extends Error {}

export function isValidTtbId(ttbid: string): boolean {
  return /^\d{14}$/.test(ttbid);
}

/** Strip tags into an ordered token stream (the page is label/value table cells). */
function tokenize(html: string): string[] {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const piped = noScript.replace(/<[^>]+>/g, "|");
  const decoded = piped
    .replace(/&nbsp;?/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  return decoded
    .split("|")
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Numbered form labels ("6. BRAND NAME", "8a. MAILING ADDRESS...") or section heads. */
function isLabel(token: string): boolean {
  return (
    /^\d{1,2}[a-z]?\.\s/.test(token) ||
    /^PART (I|II|III)\b/.test(token) ||
    token === "FOR TTB USE ONLY"
  );
}

const QUALIFIERS = new Set([
  "(Required)",
  "(If any)",
  "(Check applicable box(es))",
]);

function valueAfter(tokens: string[], label: string): string | null {
  const idx = tokens.findIndex((t) => t === label || t.startsWith(label));
  if (idx === -1) return null;
  for (let i = idx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (QUALIFIERS.has(t)) continue;
    if (isLabel(t)) return null; // next field began — value absent
    return t;
  }
  return null;
}

/** Multi-line value: collect tokens after the label until the next label. */
function blockAfter(tokens: string[], label: string): string[] {
  const idx = tokens.findIndex((t) => t.startsWith(label));
  if (idx === -1) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (QUALIFIERS.has(t)) continue;
    if (isLabel(t)) break;
    out.push(t);
  }
  return out;
}

function checkedAlt(html: string): string[] {
  const alts: string[] = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bchecked\b/i.test(tag)) continue;
    const alt = tag.match(/alt="([^"]*)"/i);
    if (alt) alts.push(alt[1]);
  }
  return alts;
}

export interface ColaPrefill {
  ttbid: string;
  application: ColaApplication;
}

export function parseColaHtml(html: string): ColaPrefill {
  const tokens = tokenize(html);
  const alts = checkedAlt(html);

  const ttbid = valueAfter(tokens, "TTB ID");
  const brandName = valueAfter(tokens, "6. BRAND NAME");
  const serialNumber = valueAfter(tokens, "4. SERIAL NUMBER");
  const netContents = valueAfter(tokens, "12. NET CONTENTS");
  const alcoholContent = valueAfter(tokens, "13. ALCOHOL CONTENT");
  const fancifulName = valueAfter(tokens, "7. FANCIFUL NAME");
  const wineAppellation = valueAfter(tokens, "14. WINE APPELLATION IF ON LABEL");
  const wineVintage = valueAfter(tokens, "15. WINE VINTAGE DATE IF ON LABEL");
  const classType = valueAfter(tokens, "CLASS/TYPE DESCRIPTION");

  const addressTokens = blockAfter(tokens, "8. NAME AND ADDRESS OF APPLICANT").map((t) =>
    t.replace(/\(Used on label\)/i, "").replace(/\s+/g, " ").trim()
  );
  const applicantNameAddress = addressTokens.filter(Boolean).join(", ");

  const typeAlt = alts.find((a) => a.startsWith("Type of Product:"));
  const beverageType =
    typeAlt === "Type of Product: Wine"
      ? ("wine" as const)
      : typeAlt === "Type of Product: Distilled Spirits"
        ? ("distilled_spirits" as const)
        : typeAlt === "Type of Product: Malt Beverage"
          ? ("malt_beverage" as const)
          : null;
  const sourceAlt = alts.find((a) => a.startsWith("Source of Product:"));
  const sourceOfProduct =
    sourceAlt === "Source of Product: Domestic"
      ? ("domestic" as const)
      : sourceAlt === "Source of Product: Imported"
        ? ("imported" as const)
        : null;

  if (!ttbid || !brandName || !serialNumber || !netContents || !alcoholContent || !beverageType || !sourceOfProduct) {
    throw new ColaParseError(
      "Registry page did not contain the expected COLA form fields (page structure may have changed)."
    );
  }

  const application = ColaApplication.parse({
    serialNumber,
    beverageType,
    sourceOfProduct,
    brandName,
    ...(fancifulName ? { fancifulName } : {}),
    classType: classType ?? "(not stated on certificate)",
    alcoholContent,
    netContents,
    applicantNameAddress: applicantNameAddress || brandName,
    ...(wineAppellation ? { wineAppellation } : {}),
    ...(wineVintage ? { wineVintage } : {}),
  });

  return { ttbid, application };
}
