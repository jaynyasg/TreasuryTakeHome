import Card from "@/components/house/Card";
import StatusBadge from "@/components/StatusBadge";
import { FieldKey, VerifyResponse } from "@/lib/contract";

const FIELD_LABELS: Record<FieldKey, string> = {
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

const OVERALL: Record<
  VerifyResponse["report"]["overall"],
  { text: string; className: string; wash: string }
> = {
  all_match: {
    text: "All fields match",
    className: "text-accent-green",
    wash: "border-accent-green/20 bg-accent-green/5",
  },
  needs_review: {
    text: "Agent review needed",
    className: "text-ink-2",
    wash: "border-accent-amber/30 bg-accent-amber/10",
  },
  has_mismatches: {
    text: "Issues found",
    className: "text-accent-red",
    wash: "border-accent-red/20 bg-accent-red/5",
  },
};

export default function ResultPanel({ result }: { result: VerifyResponse }) {
  const { report, elapsedMs } = result;
  const overall = OVERALL[report.overall];
  return (
    <Card className="animate-riseIn">
      <div
        className={`flex items-end justify-between rounded-lg border px-4 py-3 ${overall.wash}`}
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Match score
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-5xl font-semibold tracking-tight">{report.matchPercentage}%</span>
            <span className={`text-[13px] font-medium ${overall.className}`}>{overall.text}</span>
          </div>
        </div>
        <div className="text-right text-[11px] text-muted">
          <div className="font-mono">{(elapsedMs / 1000).toFixed(1)}s</div>
          <div>verification time</div>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{report.summary}</p>

      <ul className="mt-4 space-y-2">
        {report.verdicts.map((v) => (
          <li
            key={v.field}
            className={
              "rounded-lg border border-line-2 px-3 py-2.5 " +
              (v.status === "not_applicable" ? "opacity-50" : "")
            }
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium">{FIELD_LABELS[v.field]}</span>
              <StatusBadge status={v.status} />
            </div>
            {v.status !== "not_applicable" && (
              <>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11.5px]">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Application </span>
                    <span className="font-mono text-ink-2">{v.applicationValue ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Label </span>
                    <span className="font-mono text-ink-2">{v.labelValue ?? "—"}</span>
                  </div>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{v.reason}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
