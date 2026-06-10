"use client";

import { useState } from "react";
import Card from "@/components/house/Card";
import IconButton from "@/components/house/IconButton";
import Chip from "@/components/house/Chip";
import Badge from "@/components/house/Badge";
import Modal from "@/components/house/Modal";
import { Cube, Sparkles } from "@/components/house/icons";
import ResultPanel from "@/components/ResultPanel";
import { GeneratedCase, VerifyResponse } from "@/lib/contract";
import { generateCase } from "@/lib/engine/generator";
import { runBatch } from "@/lib/engine/batch";
import { renderLabelSvg } from "@/lib/labelSvg";
import { svgToPngDataUrl, verifyCase } from "@/lib/client";

interface CaseRow {
  seed: number;
  data: GeneratedCase;
  svg: string;
  state: { kind: "idle" } | { kind: "running" } | { kind: "done"; result: VerifyResponse } | { kind: "error"; message: string };
}

function makeRows(startSeed: number, count: number, defects: number): CaseRow[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = startSeed + i;
    // Spread defect counts so a batch shows a mix of clean and flawed labels.
    const d = defects < 0 ? i % 3 : defects;
    const data = generateCase(seed, { defects: d });
    return { seed, data, svg: renderLabelSvg(data, seed), state: { kind: "idle" } };
  });
}

export default function GeneratorView() {
  const [count, setCount] = useState(6);
  const [defectMode, setDefectMode] = useState<-1 | 0 | 1 | 2>(-1);
  const [startSeed, setStartSeed] = useState(1);
  const [rows, setRows] = useState<CaseRow[]>(() => makeRows(1, 6, -1));
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<CaseRow | null>(null);

  const regenerate = () => {
    const seed = startSeed + count;
    setStartSeed(seed);
    setRows(makeRows(seed, count, defectMode));
  };

  const setRowState = (seed: number, state: CaseRow["state"]) =>
    setRows((prev) => prev.map((r) => (r.seed === seed ? { ...r, state } : r)));

  const verifyOne = async (row: CaseRow) => {
    setRowState(row.seed, { kind: "running" });
    try {
      const png = await svgToPngDataUrl(row.svg);
      const result = await verifyCase(row.data.application, [png]);
      setRowState(row.seed, { kind: "done", result });
    } catch (err) {
      setRowState(row.seed, { kind: "error", message: err instanceof Error ? err.message : "failed" });
    }
  };

  const verifyAll = async () => {
    setBusy(true);
    // Demo-scale batch: client fan-out, 4 concurrent. Scale-path for 300-at-once
    // (server queue + progress streaming) is documented in the README.
    await runBatch(rows, (row) => verifyOne(row), { concurrency: 4 });
    setBusy(false);
  };

  const done = rows.filter((r) => r.state.kind === "done");
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
              Generated labels are rendered to images and verified through the same vision
              pipeline as uploads — nothing is faked.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Cases</span>
            {[3, 6, 12].map((n) => (
              <Chip key={n} tone={count === n ? "highlight" : "neutral"} onClick={() => setCount(n)}>
                {n}
              </Chip>
            ))}
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Defects</span>
            {([["mix", -1], ["clean", 0], ["1", 1], ["2", 2]] as const).map(([label, v]) => (
              <Chip key={label} tone={defectMode === v ? "highlight" : "neutral"} onClick={() => setDefectMode(v)}>
                {label}
              </Chip>
            ))}
            <IconButton icon={<Cube />} variant="secondary" iconMotion="spin3d" onClick={regenerate}>
              Generate
            </IconButton>
            <IconButton icon={<Sparkles />} loading={busy} onClick={() => void verifyAll()}>
              Verify all {rows.length}
            </IconButton>
          </div>
        </div>
        {avg !== null && (
          <p className="mt-3 text-[13px] text-ink-2">
            Batch result: <span className="font-semibold">{done.length}/{rows.length}</span> verified,
            average match <span className="font-semibold">{avg}%</span>.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.seed} padded={false} className="overflow-hidden">
            <div
              className="border-b border-line-2 bg-surface/50 p-3 [&>svg]:h-auto [&>svg]:w-full [&>svg]:rounded"
              dangerouslySetInnerHTML={{ __html: row.svg }}
            />
            <div className="space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-muted">case #{row.seed}</span>
                {row.data.injectedDefects.length === 0 ? (
                  <Badge className="border-accent-green/40 bg-accent-green/10 text-accent-green">clean</Badge>
                ) : (
                  <Badge className="border-accent-red/40 bg-accent-red/10 text-accent-red">
                    {row.data.injectedDefects.length} defect{row.data.injectedDefects.length > 1 ? "s" : ""} injected
                  </Badge>
                )}
              </div>
              <div className="text-[13px] font-medium">{row.data.application.brandName}</div>
              <div className="text-[11.5px] text-muted">
                {row.data.application.classType} · {row.data.application.alcoholContent} ·{" "}
                {row.data.application.netContents}
              </div>
              <div className="flex items-center gap-2 pt-1">
                {row.state.kind === "done" ? (
                  <>
                    <span
                      className={
                        "text-xl font-semibold " +
                        (row.state.result.report.overall === "all_match"
                          ? "text-accent-green"
                          : row.state.result.report.overall === "has_mismatches"
                            ? "text-accent-red"
                            : "text-ink-2")
                      }
                    >
                      {row.state.result.report.matchPercentage}%
                    </span>
                    <Chip onClick={() => setDetail(row)}>details</Chip>
                  </>
                ) : row.state.kind === "error" ? (
                  <span className="text-[12px] text-accent-red">{row.state.message}</span>
                ) : (
                  <IconButton
                    icon={<Sparkles />}
                    variant="secondary"
                    loading={row.state.kind === "running"}
                    onClick={() => void verifyOne(row)}
                  >
                    {row.state.kind === "running" ? "Verifying…" : "Verify"}
                  </IconButton>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {detail && detail.state.kind === "done" && (
        <Modal onClose={() => setDetail(null)}>
          <div className="max-h-[80vh] w-[min(560px,90vw)] overflow-y-auto">
            {detail.data.injectedDefects.length > 0 && (
              <div className="mb-3 rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-[12.5px] text-ink-2">
                <div className="mb-1 font-semibold">Injected defects (ground truth)</div>
                <ul className="list-inside list-disc space-y-0.5">
                  {detail.data.injectedDefects.map((d) => (
                    <li key={d.field}>{d.description}</li>
                  ))}
                </ul>
              </div>
            )}
            <ResultPanel result={detail.state.result} />
          </div>
        </Modal>
      )}
    </div>
  );
}
