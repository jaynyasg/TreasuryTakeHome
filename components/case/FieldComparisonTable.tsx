import Card from "@/components/house/Card";
import Badge from "@/components/house/Badge";
import type { FieldComparison, FieldComparisonStatus } from "./types";

/**
 * Application-vs-label field comparison for Case Detail (plan "Case detail IA"
 * — comparison/evidence-first). Mirrors the verdict language and two-column
 * application/label layout of the public `components/ResultPanel.tsx`, so a
 * reviewer reads the same vocabulary they would in the single-case verifier.
 *
 * Severity is never carried by color alone (accessibility spec): every status
 * pairs a text label + a glyph with its tint.
 */

/** Friendly labels for the known contract field keys; falls back to the raw
 *  key (humanized) for any field an extended query layer introduces. */
const FIELD_LABELS: Record<string, string> = {
  brandName: "Brand name",
  fancifulName: "Fanciful name",
  classType: "Class / type",
  alcoholContent: "Alcohol content",
  netContents: "Net contents",
  producerNameAddress: "Producer name & address",
  countryOfOrigin: "Country of origin",
  wineAppellation: "Appellation",
  wineVintage: "Vintage",
  grapeVarietals: "Grape varietal(s)",
  governmentWarning: "Government warning",
};

interface StatusStyle {
  label: string;
  /** Leading glyph so status is not conveyed by color alone. */
  glyph: string;
  className: string;
}

const STATUS_STYLES: Record<FieldComparisonStatus, StatusStyle> = {
  match: {
    label: "Match",
    glyph: "✓",
    className: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  },
  close_match: {
    label: "Match*",
    glyph: "≈",
    className: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  },
  mismatch: {
    label: "Mismatch",
    glyph: "✕",
    className: "border-accent-red/40 bg-accent-red/10 text-accent-red",
  },
  missing: {
    label: "Missing",
    glyph: "—",
    className: "border-accent-red/40 bg-accent-red/10 text-accent-red",
  },
  missing_on_label: {
    label: "Missing",
    glyph: "—",
    className: "border-accent-red/40 bg-accent-red/10 text-accent-red",
  },
  needs_review: {
    label: "Review",
    glyph: "?",
    className: "border-accent-amber/50 bg-accent-amber/10 text-ink-2",
  },
  not_applicable: {
    label: "N/A",
    glyph: "·",
    className: "text-muted-2",
  },
};

function humanizeField(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // "wineAppellation" -> "Wine appellation"
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function styleFor(status: string): StatusStyle {
  return (
    STATUS_STYLES[status as FieldComparisonStatus] ?? {
      label: status,
      glyph: "·",
      className: "text-muted-2",
    }
  );
}

export default function FieldComparisonTable({
  fields,
}: {
  fields: FieldComparison[] | undefined;
}) {
  return (
    <section aria-labelledby="field-comparison-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2
          id="field-comparison-heading"
          className="text-[13px] font-semibold tracking-tight text-ink"
        >
          Application vs. label
        </h2>
        <span className="text-[11px] text-muted">
          {fields?.length ? `${fields.length} fields compared` : "no comparison yet"}
        </span>
      </div>

      {!fields || fields.length === 0 ? (
        <Card bare className="border-dashed">
          <p className="text-[12.5px] text-muted">
            No field comparison is available for this case yet. A comparison
            appears once the case has been extracted and scored by the engine.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {fields.map((f) => {
            const s = styleFor(f.status);
            const dimmed = f.status === "not_applicable";
            return (
              <li
                key={f.field}
                className={
                  "rounded-lg border border-line-2 px-3 py-2.5 " +
                  (dimmed ? "opacity-50 " : "")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink">
                    {humanizeField(f.field)}
                  </span>
                  <Badge className={s.className}>
                    <span aria-hidden className="mr-1 font-mono">
                      {s.glyph}
                    </span>
                    {s.label}
                  </Badge>
                </div>
                {!dimmed && (
                  <>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 text-[11.5px] sm:grid-cols-2">
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Application{" "}
                        </span>
                        <span className="break-words font-mono text-ink-2">
                          {f.applicationValue ?? "—"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                          Label{" "}
                        </span>
                        <span className="break-words font-mono text-ink-2">
                          {f.labelValue ?? "—"}
                        </span>
                      </div>
                    </div>
                    {f.reason && (
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">
                        {f.reason}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
