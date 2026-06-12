"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Card from "@/components/house/Card";
import IconButton from "@/components/house/IconButton";
import Chip from "@/components/house/Chip";
import Badge from "@/components/house/Badge";
import Modal from "@/components/house/Modal";
import { Cube, Sparkles, Expand } from "@/components/house/icons";
import ResultPanel from "@/components/ResultPanel";
import { ColaApplication, GeneratedCase, VerifyResponse } from "@/lib/contract";
import { generateCase } from "@/lib/engine/generator";
import { renderLabelSvg } from "@/lib/labelSvg";
import { buildBatchCsv } from "@/lib/csv";
import {
  OTIUM_APPLICATION,
  REAL_EXAMPLES,
  SANTA_FE_APPLICATION,
} from "@/lib/fixtures";
import { fileToDataUrl, svgToPdfBlob, svgToPdfDataUrl, svgToPngDataUrl, verifyCase, VerifyError } from "@/lib/client";

type RowState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: VerifyResponse }
  | { kind: "error"; message: string };

interface CaseRow {
  id: string;
  source: "synthetic" | "real" | "degraded";
  application: ColaApplication;
  defects: GeneratedCase["injectedDefects"];
  /** Synthetic rows render their own label. */
  svg?: string;
  /** Real/degraded rows verify committed sample photos. */
  imageUrls?: string[];
  state: RowState;
}

const CONCURRENCY = 6;
/** Fallback before any measured data exists (plan AC-3 / D8.3). */
const FALLBACK_COST_PER_CASE = 0.011;
const FALLBACK_MS_PER_CASE = 6500;
// GPT-4o pricing per 1M tokens.
const USD_PER_INPUT_TOKEN = 2.5 / 1e6;
const USD_PER_OUTPUT_TOKEN = 10 / 1e6;
const COMPACT_THRESHOLD = 25;

/** Real label sets + deliberately bad photos of them — mixed into batches so the run isn't purely self-generated. */
const SAMPLE_URL_BY_IMAGE: Record<string, string> = {
  "labelexample1_p2_0.jpg": "/samples/otium-front.jpg",
  "labelexample1_p3_1.jpg": "/samples/otium-back.jpg",
  "labelexample2_p2_0.jpg": "/samples/santa-fe.jpg",
  "labelexample3_p2_0.jpg": "/samples/eight-chains.jpg",
};

function sampleUrls(images: string[]): string[] {
  return images.map((image) => SAMPLE_URL_BY_IMAGE[image] ?? `/samples/${image}`);
}

const REAL_MIX: Array<Pick<CaseRow, "id" | "source" | "application" | "imageUrls">> = [
  ...REAL_EXAMPLES.map((example) => ({
    id: example.id,
    source: "real" as const,
    application: example.application,
    imageUrls: sampleUrls(example.images),
  })),
  { id: "degraded-perspective-otium", source: "degraded", application: OTIUM_APPLICATION, imageUrls: ["/samples/degraded-otium-front.jpg", "/samples/degraded-otium-back.jpg"] },
  { id: "degraded-glare-santa-fe", source: "degraded", application: SANTA_FE_APPLICATION, imageUrls: ["/samples/degraded-glare-santa-fe.jpg"] },
];

function makeRows(startSeed: number, count: number, defects: number, includeReal: boolean): CaseRow[] {
  const synthetic: CaseRow[] = Array.from({ length: count }, (_, i) => {
    const seed = startSeed + i;
    const d = defects < 0 ? i % 3 : defects;
    const data = generateCase(seed, { defects: d });
    return {
      id: String(seed),
      source: "synthetic",
      application: data.application,
      defects: data.injectedDefects,
      svg: renderLabelSvg(data, seed),
      state: { kind: "idle" },
    };
  });
  const mix: CaseRow[] = includeReal
    ? REAL_MIX.map((r) => ({ ...r, defects: [], state: { kind: "idle" as const } }))
    : [];
  return [...mix, ...synthetic];
}

async function rowImageDataUrls(row: CaseRow): Promise<string[]> {
  if (row.svg) return [await svgToPdfDataUrl(row.svg)];
  const urls = row.imageUrls ?? [];
  return Promise.all(
    urls.map(async (url) => {
      const blob = await fetch(url).then((r) => r.blob());
      const name = url.split("/").pop() ?? "label.jpg";
      return fileToDataUrl(new File([blob], name, { type: blob.type || "image/jpeg" }));
    })
  );
}

function downloadBlob(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GeneratorView() {
  const [count, setCount] = useState(6);
  const [defectMode, setDefectMode] = useState<-1 | 0 | 1 | 2>(-1);
  const [includeReal, setIncludeReal] = useState(false);
  const [startSeed, setStartSeed] = useState(1);
  const [rows, setRows] = useState<CaseRow[]>(() => makeRows(1, 6, -1, false));
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<CaseRow | null>(null);
  const [confirm300, setConfirm300] = useState(false);
  const cancelRef = useRef(false);
  // Measured cost/latency from completed verifications (D8.3).
  const measured = useRef({ n: 0, inTok: 0, outTok: 0, ms: 0 });

  const done = rows.filter((r) => r.state.kind === "done");
  const errors = rows.filter((r) => r.state.kind === "error");
  const completed = done.length + errors.length;
  const compact = rows.length > COMPACT_THRESHOLD;

  // Paid results vanish on tab close — warn while a batch is in flight (4A).
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const costPerCase = measured.current.n
    ? (measured.current.inTok / measured.current.n) * USD_PER_INPUT_TOKEN +
      (measured.current.outTok / measured.current.n) * USD_PER_OUTPUT_TOKEN
    : FALLBACK_COST_PER_CASE;
  const msPerCase = measured.current.n ? measured.current.ms / measured.current.n : FALLBACK_MS_PER_CASE;
  const isMeasured = measured.current.n > 0;

  const regenerate = (nextCount = count, nextIncludeReal = includeReal) => {
    const seed = startSeed + count;
    setStartSeed(seed);
    setRows(makeRows(seed, nextCount, defectMode, nextIncludeReal));
  };

  const chooseCount = (n: number) => {
    if (n === 300) {
      setConfirm300(true);
      return;
    }
    setCount(n);
    regenerate(n);
  };

  const setRowState = (id: string, state: RowState) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state } : r)));

  const verifyOne = async (row: CaseRow): Promise<void> => {
    setRowState(row.id, { kind: "running" });
    try {
      const images = await rowImageDataUrls(row);
      const result = await verifyCase(row.application, images);
      if (result.usage) {
        measured.current.n += 1;
        measured.current.inTok += result.usage.inputTokens;
        measured.current.outTok += result.usage.outputTokens;
        measured.current.ms += result.elapsedMs;
      }
      setRowState(row.id, { kind: "done", result });
    } catch (err) {
      const message =
        err instanceof VerifyError && err.retryable
          ? `${err.message} (retried, still failing)`
          : err instanceof Error
            ? err.message
            : "failed";
      setRowState(row.id, { kind: "error", message });
    }
  };

  /** Worker pool: cancel stops dispatching; in-flight calls complete (and bill). */
  const verifyAll = async () => {
    setRunning(true);
    cancelRef.current = false;
    const queue = rows.filter((r) => r.state.kind !== "done");
    let next = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (next < queue.length && !cancelRef.current) {
        const row = queue[next++];
        await verifyOne(row);
      }
    });
    await Promise.all(workers);
    setRunning(false);
  };

  const exportCsv = () => {
    const csv = buildBatchCsv(
      rows.map((r) => ({
        id: r.id,
        kind: r.source,
        brand: r.application.brandName,
        beverageType: r.application.beverageType,
        defectsInjected:
          r.source === "synthetic"
            ? r.defects.map((d) => d.description).join("; ") || "none"
            : "n/a",
        result: r.state.kind === "done" ? r.state.result : null,
        error: r.state.kind === "error" ? r.state.message : null,
      }))
    );
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "batch-results.csv");
  };

  const downloadPng = async (row: CaseRow) => {
    if (!row.svg) return;
    const dataUrl = await svgToPngDataUrl(row.svg);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `case-${row.id}.png`;
    a.click();
  };

  const downloadPdf = async (row: CaseRow) => {
    if (!row.svg) return;
    downloadBlob(await svgToPdfBlob(row.svg), `case-${row.id}.pdf`);
  };

  const avg = done.length
    ? Math.round(done.reduce((s, r) => s + (r.state.kind === "done" ? r.state.result.report.matchPercentage : 0), 0) / done.length)
    : null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Mock application + label generator</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Generated labels are rendered to PDFs by default and verified through the same
              pipeline as uploaded files.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Cases</span>
            {[3, 6, 12, 50, 300].map((n) => (
              <Chip key={n} tone={count === n ? "highlight" : "neutral"} disabled={running} onClick={() => chooseCount(n)}>
                {n}
              </Chip>
            ))}
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Defects</span>
            {([["mix", -1], ["clean", 0], ["1", 1], ["2", 2]] as const).map(([label, v]) => (
              <Chip key={label} tone={defectMode === v ? "highlight" : "neutral"} disabled={running} onClick={() => setDefectMode(v)}>
                {label}
              </Chip>
            ))}
            <Chip
              tone={includeReal ? "highlight" : "neutral"}
              disabled={running}
              onClick={() => {
                setIncludeReal(!includeReal);
                regenerate(count, !includeReal);
              }}
            >
              + real examples
            </Chip>
            <IconButton icon={<Cube />} variant="secondary" iconMotion="spin3d" disabled={running} onClick={() => regenerate()}>
              Generate
            </IconButton>
            {running ? (
              <IconButton
                icon={<Expand />}
                variant="secondary"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                Cancel
              </IconButton>
            ) : (
              <IconButton icon={<Sparkles />} onClick={() => void verifyAll()}>
                Verify all {rows.length}
              </IconButton>
            )}
          </div>
        </div>

        {(running || completed > 0) && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[12px] text-ink-2">
              <span>
                {completed}/{rows.length} verified
                {errors.length > 0 && <span className="text-accent-red"> · {errors.length} failed</span>}
                {avg !== null && <span> · average match <span className="font-semibold">{avg}%</span></span>}
              </span>
              <span className="flex items-center gap-2">
                {done.length > 0 && (
                  <Chip onClick={exportCsv}>Download CSV</Chip>
                )}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-pill bg-line-2">
              <div
                className="h-full rounded-pill bg-accent transition-all duration-300"
                style={{ width: `${rows.length ? (completed / rows.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {compact ? (
        <Card padded={false}>
          <ul className="divide-y divide-line-2">
            {rows.map((row) => (
              <CompactRow key={row.id} row={row} running={running} onVerify={verifyOne} onDetail={setDetail} />
            ))}
          </ul>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <CaseCard
              key={row.id}
              row={row}
              running={running}
              onVerify={verifyOne}
              onDetail={setDetail}
              onDownloadPng={downloadPng}
              onDownloadPdf={downloadPdf}
            />
          ))}
        </div>
      )}

      {detail && detail.state.kind === "done" && (
        <Modal onClose={() => setDetail(null)}>
          <div className="max-h-[80vh] w-[min(560px,90vw)] overflow-y-auto">
            {detail.defects.length > 0 && (
              <div className="mb-3 rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-[12.5px] text-ink-2">
                <div className="mb-1 font-semibold">Injected defects (ground truth)</div>
                <ul className="list-inside list-disc space-y-0.5">
                  {detail.defects.map((d) => (
                    <li key={d.field}>{d.description}</li>
                  ))}
                </ul>
              </div>
            )}
            <ResultPanel result={detail.state.result} />
          </div>
        </Modal>
      )}

      {confirm300 && (
        <Modal onClose={() => setConfirm300(false)}>
          <div className="w-[min(440px,90vw)] space-y-3">
            <h3 className="text-[15px] font-semibold">Run a 300-case batch?</h3>
            <p className="text-[13px] leading-relaxed text-ink-2">
              300 verifications cost about <span className="font-semibold">${(300 * costPerCase).toFixed(2)}</span> in
              model usage and take roughly{" "}
              <span className="font-semibold">{Math.ceil((300 * msPerCase) / CONCURRENCY / 60000)} minutes</span>{" "}
              at {CONCURRENCY} concurrent requests
              {isMeasured ? " (based on this session's measured usage)" : " (estimate — no measured runs yet)"}.
              Cancelling stops new requests; in-flight ones complete and are billed.
            </p>
            <div className="flex justify-end gap-2">
              <Chip onClick={() => setConfirm300(false)}>Back</Chip>
              <IconButton
                icon={<Sparkles />}
                onClick={() => {
                  setConfirm300(false);
                  setCount(300);
                  regenerate(300);
                }}
              >
                Generate 300
              </IconButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Memoized: only the row whose state reference changed re-renders (eng-review 4A). */
const CaseCard = memo(function CaseCard({
  row,
  running,
  onVerify,
  onDetail,
  onDownloadPng,
  onDownloadPdf,
}: {
  row: CaseRow;
  running: boolean;
  onVerify: (row: CaseRow) => Promise<void>;
  onDetail: (row: CaseRow) => void;
  onDownloadPng: (row: CaseRow) => Promise<void>;
  onDownloadPdf: (row: CaseRow) => Promise<void>;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      {row.svg ? (
        <div
          className="border-b border-line-2 bg-surface/50 p-3 [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded"
          dangerouslySetInnerHTML={{ __html: row.svg }}
        />
      ) : (
        <div className="flex gap-2 border-b border-line-2 bg-surface/50 p-3">
          {(row.imageUrls ?? []).map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt={row.id} className="h-40 min-w-0 flex-1 rounded object-contain" />
          ))}
        </div>
      )}
      <div className="space-y-2 p-3.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-muted">case #{row.id}</span>
          <SourceBadge row={row} />
        </div>
        <div className="text-[13px] font-medium">{row.application.brandName}</div>
        <div className="text-[11.5px] text-muted">
          {row.application.classType} · {row.application.alcoholContent} · {row.application.netContents}
        </div>
        <RowActions row={row} running={running} onVerify={onVerify} onDetail={onDetail} />
        {row.svg && (
          <div className="flex flex-wrap gap-2">
            <Chip tone="highlight" onClick={() => void onDownloadPdf(row)}>Download PDF</Chip>
            <Chip onClick={() => void onDownloadPng(row)}>PNG</Chip>
          </div>
        )}
      </div>
    </Card>
  );
});

const CompactRow = memo(function CompactRow({
  row,
  running,
  onVerify,
  onDetail,
}: {
  row: CaseRow;
  running: boolean;
  onVerify: (row: CaseRow) => Promise<void>;
  onDetail: (row: CaseRow) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="w-28 shrink-0 font-mono text-[11px] text-muted">#{row.id}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{row.application.brandName}</span>
      <SourceBadge row={row} />
      <span className="w-44 shrink-0 text-right">
        <RowActions row={row} running={running} onVerify={onVerify} onDetail={onDetail} />
      </span>
    </li>
  );
});

function SourceBadge({ row }: { row: CaseRow }) {
  if (row.source === "real") {
    return <Badge className="border-accent-blue/40 bg-accent-blue/10 text-accent-blue">real</Badge>;
  }
  if (row.source === "degraded") {
    return <Badge className="border-accent-amber/50 bg-accent-amber/10 text-ink-2">bad photo</Badge>;
  }
  if (row.defects.length === 0) {
    return <Badge className="border-accent-green/40 bg-accent-green/10 text-accent-green">clean</Badge>;
  }
  return (
    <Badge className="border-accent-red/40 bg-accent-red/10 text-accent-red">
      {row.defects.length} defect{row.defects.length > 1 ? "s" : ""} injected
    </Badge>
  );
}

function RowActions({
  row,
  running,
  onVerify,
  onDetail,
}: {
  row: CaseRow;
  running: boolean;
  onVerify: (row: CaseRow) => Promise<void>;
  onDetail: (row: CaseRow) => void;
}) {
  if (row.state.kind === "done") {
    const overall = row.state.result.report.overall;
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={
            "text-lg font-semibold " +
            (overall === "all_match"
              ? "text-accent-green"
              : overall === "has_mismatches"
                ? "text-accent-red"
                : "text-ink-2")
          }
        >
          {row.state.result.report.matchPercentage}%
        </span>
        <Chip onClick={() => onDetail(row)}>details</Chip>
      </span>
    );
  }
  if (row.state.kind === "error") {
    return (
      <span className="inline-block rounded-lg border border-accent-red/30 bg-accent-red/5 px-2.5 py-1.5 text-[12px] text-accent-red">
        {row.state.message}
      </span>
    );
  }
  return (
    <IconButton
      icon={<Sparkles />}
      variant="secondary"
      loading={row.state.kind === "running"}
      disabled={running && row.state.kind === "idle"}
      onClick={() => void onVerify(row)}
    >
      {row.state.kind === "running" ? "Verifying…" : "Verify"}
    </IconButton>
  );
}
