import Card from "@/components/house/Card";
import Badge from "@/components/house/Badge";
import { Image as ImageIcon } from "@/components/house/icons";
import type { WarningEvidenceView } from "./types";

/**
 * GOVERNMENT WARNING evidence panel (plan "Warning evidence UI"). Shows the
 * warning crop (served via the authorized `/api/files/{id}` route), whether the
 * all-caps lead-in was detected, the boldness confidence, the plain-language
 * uncertainty reason, and the match / mismatch / needs_review explanation.
 *
 * Deliberately NOT a forensic editor (plan scope): a single read-only crop plus
 * a plain-language explanation. Every visual signal has a text alternative so
 * the panel is fully usable without seeing the image (accessibility spec:
 * "Warning crops include text alternatives").
 */

interface VerdictStyle {
  label: string;
  glyph: string;
  className: string;
  note: string;
}

const VERDICT_STYLES: Record<string, VerdictStyle> = {
  match: {
    label: "Warning matches",
    glyph: "✓",
    className: "border-accent-green/40 bg-accent-green/10 text-accent-green",
    note: "The mandatory warning text and capitalization were verified.",
  },
  mismatch: {
    label: "Warning mismatch",
    glyph: "✕",
    className: "border-accent-red/40 bg-accent-red/10 text-accent-red",
    note: "The warning text or capitalization does not meet the requirement.",
  },
  needs_review: {
    label: "Needs review",
    glyph: "?",
    className: "border-accent-amber/50 bg-accent-amber/10 text-ink-2",
    note: "The text is readable but boldness is uncertain — routed to a human rather than auto-rejected.",
  },
};

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const n = value <= 1 ? value * 100 : value;
  return `${Math.round(n)}%`;
}

export default function WarningEvidence({
  warning,
}: {
  warning: WarningEvidenceView | undefined;
}) {
  return (
    <section aria-labelledby="warning-evidence-heading" className="flex flex-col gap-2.5">
      <h2
        id="warning-evidence-heading"
        className="text-[13px] font-semibold tracking-tight text-ink"
      >
        Government warning evidence
      </h2>

      {!warning ? (
        <Card bare className="border-dashed">
          <p className="text-[12.5px] text-muted">
            No warning evidence has been captured for this case yet. Evidence is
            recorded when the worker extracts and checks the GOVERNMENT WARNING.
          </p>
        </Card>
      ) : (
        <Card bare>
          <div className="flex flex-col gap-4 md:flex-row">
            {/* Crop (or a clear "no crop" state) */}
            <div className="md:w-1/2">
              {warning.cropFileId ? (
                // Authorized signed/proxied bytes from /api/files/{id}; not a
                // static asset, so next/image is intentionally not used.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files/${encodeURIComponent(warning.cropFileId)}`}
                  alt="Cropped GOVERNMENT WARNING region from the uploaded label image."
                  className="w-full rounded-lg border border-line-2 bg-surface object-contain"
                />
              ) : (
                <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-2 bg-surface text-center">
                  <span className="text-muted-2" aria-hidden>
                    <ImageIcon size={20} />
                  </span>
                  <p className="px-3 text-[12px] text-muted">
                    No crop captured. The warning check ran on extracted text
                    without a stored image region.
                  </p>
                </div>
              )}
            </div>

            {/* Text alternative + signals */}
            <div className="flex flex-1 flex-col gap-2.5">
              {warning.verdict && VERDICT_STYLES[warning.verdict] ? (
                <div>
                  <Badge className={VERDICT_STYLES[warning.verdict].className}>
                    <span aria-hidden className="mr-1 font-mono">
                      {VERDICT_STYLES[warning.verdict].glyph}
                    </span>
                    {VERDICT_STYLES[warning.verdict].label}
                  </Badge>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
                    {VERDICT_STYLES[warning.verdict].note}
                  </p>
                </div>
              ) : (
                <Badge>Warning verdict unavailable</Badge>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Lead-in
                  </dt>
                  <dd className="text-ink-2">
                    {warning.leadInDetected === null
                      ? "Unknown"
                      : warning.leadInDetected
                        ? "All-caps lead-in detected"
                        : "Lead-in not detected"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Boldness confidence
                  </dt>
                  <dd className="font-mono text-ink-2">
                    {pct(warning.boldnessConfidence)}
                  </dd>
                </div>
              </dl>

              {warning.uncertaintyReason && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Why the machine was uncertain
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
                    {warning.uncertaintyReason}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </section>
  );
}
