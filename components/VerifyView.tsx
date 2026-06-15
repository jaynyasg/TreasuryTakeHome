"use client";

import { useEffect, useRef, useState } from "react";
import Card from "@/components/house/Card";
import IconButton from "@/components/house/IconButton";
import Chip from "@/components/house/Chip";
import Stepper from "@/components/house/Stepper";
import { Sparkles, Image as ImageIcon, X as XIcon, Bolt, FilePdf } from "@/components/house/icons";
import ApplicationForm from "@/components/ApplicationForm";
import ResultPanel from "@/components/ResultPanel";
import Badge from "@/components/house/Badge";
import { ColaApplication, VerifyResponse } from "@/lib/contract";
import { OTIUM_APPLICATION, OTIUM_TTB_ID } from "@/lib/fixtures";
import { extractApplicationFromFiles, fetchColaPrefill, fileToDataUrl, verifyCase } from "@/lib/client";
import {
  ACCEPTED_LABEL_FILE_TYPES,
  formatBytes,
  inferSupportedLabelMime,
  isPdfDataUrl,
  isSupportedLabelFile,
  MAX_FULL_APPLICATION_FILES,
  MAX_FULL_APPLICATION_UPLOAD_BYTES,
  MAX_LABEL_FILES,
  MAX_LABEL_UPLOAD_BYTES,
} from "@/lib/labelFiles";

const VERIFY_STEPS = [
  { label: "Upload", icon: <ImageIcon /> },
  { label: "Read label", icon: <Sparkles /> },
  { label: "Match fields", icon: <Bolt /> },
];

const EMPTY_APPLICATION: ColaApplication = {
  serialNumber: "",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "",
  classType: "",
  alcoholContent: "",
  netContents: "",
  applicantNameAddress: "",
};

const SAMPLE_APPLICATION = OTIUM_APPLICATION;
const SAMPLE_IMAGES = ["/samples/otium-front.jpg", "/samples/otium-back.jpg"];
const DEGRADED_SAMPLE_IMAGES = [
  "/samples/degraded-otium-front.jpg",
  "/samples/degraded-otium-back.jpg",
];

const FULL_APPLICATION_CONCURRENCY = 4;

type LabelFileKind = "image" | "pdf";

interface LabelFile {
  id: string;
  name: string;
  dataUrl: string;
  kind: LabelFileKind;
  size: number;
}

interface FullApplicationFile {
  id: string;
  name: string;
  file: File;
  kind: LabelFileKind;
  size: number;
}

type FullPdfState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; application: ColaApplication; result: VerifyResponse }
  | { kind: "error"; message: string };

interface FullPdfRow extends FullApplicationFile {
  state: FullPdfState;
}

type ActiveResult = "manual" | "full";

export default function VerifyView() {
  const [application, setApplication] = useState<ColaApplication>(EMPTY_APPLICATION);
  const [manualFiles, setManualFiles] = useState<LabelFile[]>([]);
  const [fullPdfRows, setFullPdfRows] = useState<FullPdfRow[]>([]);
  const [manualBusy, setManualBusy] = useState(false);
  const [fullBusy, setFullBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [manualError, setManualError] = useState<string | null>(null);
  const [fullError, setFullError] = useState<string | null>(null);
  const [manualResult, setManualResult] = useState<VerifyResponse | null>(null);
  const [activeResult, setActiveResult] = useState<ActiveResult>("manual");
  const [activeFullId, setActiveFullId] = useState<string | null>(null);
  const [ttbId, setTtbId] = useState("");
  const [colaBusy, setColaBusy] = useState(false);
  const [colaSource, setColaSource] = useState<"live" | "cached" | null>(null);
  const manualFileInput = useRef<HTMLInputElement>(null);
  const fullPdfInput = useRef<HTMLInputElement>(null);
  const fullCancelRef = useRef(false);

  const applicationReady =
    application.brandName.trim() !== "" &&
    application.classType.trim() !== "" &&
    application.applicantNameAddress.trim() !== "";

  const prefillFromRegistry = async (id: string) => {
    setColaBusy(true);
    setColaSource(null);
    setManualError(null);
    try {
      const prefill = await fetchColaPrefill(id.trim());
      setApplication(prefill.application);
      setColaSource(prefill.source);
      setTtbId(prefill.ttbid);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Registry lookup failed.");
    } finally {
      setColaBusy(false);
    }
  };

  const addManualFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    setManualError(null);
    try {
      const supported = Array.from(files).filter(isSupportedLabelFile);
      if (supported.length === 0) {
        setManualError("Add a PDF, PNG, JPEG, or WebP label file.");
        return;
      }
      const remainingSlots = MAX_LABEL_FILES - manualFiles.length;
      if (remainingSlots <= 0) {
        setManualError(`Remove a label file before adding another one. This prototype accepts up to ${MAX_LABEL_FILES}.`);
        return;
      }
      const nextFiles = supported.slice(0, remainingSlots);
      const totalBytes =
        manualFiles.reduce((sum, file) => sum + file.size, 0) +
        nextFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_LABEL_UPLOAD_BYTES) {
        setManualError(
          `Selected label files total ${formatBytes(totalBytes)}. Use a PDF or image set under ${formatBytes(MAX_LABEL_UPLOAD_BYTES)}.`
        );
        return;
      }
      const added = await Promise.all(nextFiles.map(readLabelFile));
      setManualFiles((prev) => [...prev, ...added].slice(0, MAX_LABEL_FILES));
      setActiveResult("manual");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Could not read the label file.");
    }
  };

  const addFullPdfs = (files: FileList | File[] | null) => {
    if (!files) return;
    setFullError(null);
    const supported = Array.from(files).filter(isSupportedLabelFile);
    if (supported.length === 0) {
      setFullError("Add one or more complete COLA application PDFs or images.");
      return;
    }
    const remainingSlots = MAX_FULL_APPLICATION_FILES - fullPdfRows.length;
    if (remainingSlots <= 0) {
      setFullError(
        `Remove an application file before adding another one. This runner accepts up to ${MAX_FULL_APPLICATION_FILES}.`
      );
      return;
    }
    const nextFiles = supported.slice(0, remainingSlots);
    const oversized = nextFiles.find((file) => file.size > MAX_FULL_APPLICATION_UPLOAD_BYTES);
    if (oversized) {
      setFullError(
        `${oversized.name} is ${formatBytes(oversized.size)}. Use application files under ${formatBytes(MAX_FULL_APPLICATION_UPLOAD_BYTES)} each.`
      );
      return;
    }
    const added = nextFiles.map(readFullApplicationFile);
    setFullPdfRows((prev) =>
      [...prev, ...added.map((file) => ({ ...file, state: { kind: "idle" as const } }))].slice(
        0,
        MAX_FULL_APPLICATION_FILES
      )
    );
    setActiveFullId((prev) => prev ?? added[0]?.id ?? null);
    setActiveResult("full");
    if (supported.length > remainingSlots) {
      setFullError(
        `Added the first ${remainingSlots} file${remainingSlots === 1 ? "" : "s"}; this runner accepts up to ${MAX_FULL_APPLICATION_FILES}.`
      );
    }
  };

  // AC-6: Ctrl+V a screenshot straight onto the manual label workflow.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const labelFiles = items
        .filter((i) => i.type.startsWith("image/") || i.type === "application/pdf")
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null && isSupportedLabelFile(f));
      if (labelFiles.length === 0) return;
      e.preventDefault();
      void addManualFiles(labelFiles);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualFiles.length]);

  useEffect(() => {
    if (!fullBusy) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [fullBusy]);

  const loadSample = async (imageUrls: string[]) => {
    setManualError(null);
    setManualResult(null);
    setApplication(SAMPLE_APPLICATION);
    setActiveResult("manual");
    try {
      const imgs = await Promise.all(
        imageUrls.map(async (url) => {
          const blob = await fetch(url).then((r) => r.blob());
          const name = url.split("/").pop()!;
          return readLabelFile(new File([blob], name, { type: blob.type || "image/jpeg" }));
        })
      );
      setManualFiles(imgs);
    } catch {
      setManualError("Could not load the sample label files.");
    }
  };

  const verifyManual = async () => {
    if (manualFiles.length === 0) {
      setManualError("Add label files before verifying.");
      return;
    }
    if (!applicationReady) {
      setManualError("Complete brand, class/type, and applicant fields first, or use Full COLA Applications below.");
      return;
    }
    setManualBusy(true);
    setStep(0);
    setManualError(null);
    setManualResult(null);
    setActiveResult("manual");
    try {
      setManualResult(
        await verifyCase(application, manualFiles.map((file) => file.dataUrl), (stage) =>
          setStep(stage === "extracting" ? 1 : 2)
        )
      );
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setManualBusy(false);
    }
  };

  const verifyFullPdfs = async () => {
    if (fullPdfRows.length === 0) {
      setFullError("Add one or more complete COLA application files.");
      return;
    }
    const rowsToVerify = fullPdfRows.slice();
    let nextIndex = 0;
    fullCancelRef.current = false;
    setFullBusy(true);
    setFullError(null);
    setActiveResult("full");

    const runNext = async () => {
      while (nextIndex < rowsToVerify.length && !fullCancelRef.current) {
        const row = rowsToVerify[nextIndex++];
        setRowState(row.id, { kind: "running" });
        setActiveFullId(row.id);
        try {
          const dataUrl = await fileToDataUrl(row.file);
          const extractedApplication = await extractApplicationFromFiles([dataUrl]);
          const result = await verifyCase(extractedApplication, [dataUrl]);
          setRowState(row.id, { kind: "done", application: extractedApplication, result });
        } catch (err) {
          setRowState(row.id, {
            kind: "error",
            message: err instanceof Error ? err.message : "Verification failed.",
          });
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(FULL_APPLICATION_CONCURRENCY, rowsToVerify.length) }, () => runNext())
      );
      if (fullCancelRef.current) {
        setFullError("Canceled. Completed applications were kept; unstarted files are still ready.");
      }
    } finally {
      setFullBusy(false);
    }
  };

  const cancelFullVerification = () => {
    fullCancelRef.current = true;
    setFullError("Cancel requested. Active applications will finish; unstarted files will stay ready.");
  };

  const setRowState = (id: string, state: FullPdfState) => {
    setFullPdfRows((prev) => prev.map((row) => (row.id === id ? { ...row, state } : row)));
  };

  const removeFullRow = (id: string) => {
    setFullPdfRows((prev) => {
      const next = prev.filter((row) => row.id !== id);
      if (activeFullId === id) setActiveFullId(next[0]?.id ?? null);
      return next;
    });
  };

  const fullDone = fullPdfRows.filter((row) => row.state.kind === "done");
  const fullErrors = fullPdfRows.filter((row) => row.state.kind === "error");
  const activeFullRow = fullPdfRows.find((row) => row.id === activeFullId) ?? fullDone[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Application + label files</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Fill or prefill the application, then attach the matching label artwork.
              </p>
            </div>
            <div className="flex gap-1.5">
              <Chip tone="highlight" onClick={() => void loadSample(SAMPLE_IMAGES)}>
                Load real example
              </Chip>
              <Chip onClick={() => void loadSample(DEGRADED_SAMPLE_IMAGES)}>
                Try a bad photo
              </Chip>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-surface/50 px-3 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Prefill from registry
            </span>
            <input
              className="h-8 w-40 rounded-lg border border-line bg-card px-2.5 font-mono text-[12px] text-ink placeholder:text-muted-2 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="14-digit TTB ID"
              value={ttbId}
              maxLength={14}
              onChange={(e) => setTtbId(e.target.value.replace(/\D/g, ""))}
            />
            <Chip disabled={colaBusy || ttbId.length !== 14} onClick={() => void prefillFromRegistry(ttbId)}>
              {colaBusy ? "Fetching..." : "Fetch"}
            </Chip>
            <Chip disabled={colaBusy} onClick={() => void prefillFromRegistry(OTIUM_TTB_ID)}>
              Demo TTB ID
            </Chip>
            {colaSource && (
              <Badge
                className={
                  colaSource === "live"
                    ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
                    : "border-accent-amber/50 bg-accent-amber/10 text-ink-2"
                }
              >
                {colaSource === "live" ? "live registry data" : "cached fixture"}
              </Badge>
            )}
          </div>
          <ApplicationForm value={application} onChange={setApplication} />
          <div className="mt-5 border-t border-line-2 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Label files for this application</h3>
              <span className="text-[11px] text-muted">{manualFiles.length}/{MAX_LABEL_FILES}</span>
            </div>
            <FileUploadBox
              inputRef={manualFileInput}
              accept={ACCEPTED_LABEL_FILE_TYPES}
              label="Click, drop, or paste label files"
              onFiles={addManualFiles}
            />
            <FileTiles files={manualFiles} onRemove={(id) => setManualFiles((prev) => prev.filter((file) => file.id !== id))} />
            <div className="mt-4">
              <IconButton
                icon={<Sparkles />}
                loading={manualBusy}
                disabled={manualBusy || manualFiles.length === 0}
                onClick={() => void verifyManual()}
              >
                {manualBusy ? "Verifying..." : "Verify application + label"}
              </IconButton>
              {manualFiles.length === 0 && (
                <p className="mt-2 text-[11.5px] text-muted">Add label files before verifying this application.</p>
              )}
            </div>
            {manualError && (
              <p className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[12.5px] text-accent-red">
                {manualError}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Full COLA Applications</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Upload complete application PDFs or image scans here. Each file is read and verified as its own case.
              </p>
            </div>
            <span className="text-[11px] text-muted">
              {fullPdfRows.length}/{MAX_FULL_APPLICATION_FILES}
            </span>
          </div>
          <FileUploadBox
            inputRef={fullPdfInput}
            accept={ACCEPTED_LABEL_FILE_TYPES}
            label="Click or drop up to 300 complete COLA application files"
            onFiles={addFullPdfs}
          />
          {fullPdfRows.length > 0 && (
            <ul className="mt-3 divide-y divide-line-2 rounded-lg border border-line-2">
              {fullPdfRows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                  <FileKindIcon kind={row.kind} />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveResult("full");
                      setActiveFullId(row.id);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink-2 hover:text-ink"
                    title={row.name}
                  >
                    {row.name}
                  </button>
                  <FullRowStatus row={row} />
                  <button
                    type="button"
                    aria-label={`Remove ${row.name}`}
                    disabled={fullBusy}
                    onClick={() => removeFullRow(row.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-ink disabled:opacity-40"
                  >
                    <XIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <IconButton
              icon={<Sparkles />}
              loading={fullBusy}
              disabled={fullBusy || fullPdfRows.length === 0}
              onClick={() => void verifyFullPdfs()}
            >
              {fullBusy
                ? `Verifying ${fullDone.length}/${fullPdfRows.length}...`
                : fullPdfRows.length > 0
                  ? `Verify ${fullPdfRows.length} full application${fullPdfRows.length === 1 ? "" : "s"}`
                  : "Verify full applications"}
            </IconButton>
            {fullBusy && <Chip onClick={cancelFullVerification}>Cancel after current</Chip>}
            {fullPdfRows.length === 0 && (
              <p className="basis-full text-[11.5px] text-muted">
                Use this for complete COLA application PDFs or image scans.
              </p>
            )}
          </div>
          {fullError && (
            <p className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[12.5px] text-accent-red">
              {fullError}
            </p>
          )}
        </Card>
      </div>

      <div>
        {activeResult === "full" ? (
          <FullPdfResults
            rows={fullPdfRows}
            done={fullDone.length}
            errors={fullErrors.length}
            activeRow={activeFullRow}
            onSelect={(id) => {
              setActiveResult("full");
              setActiveFullId(id);
            }}
          />
        ) : manualBusy ? (
          <BusyPanel step={step} />
        ) : manualResult ? (
          <ResultPanel result={manualResult} />
        ) : (
          <EmptyResults />
        )}
      </div>
    </div>
  );
}

function BusyPanel({ step }: { step: number }) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-card border border-dashed border-line bg-surface/40 px-4 text-center">
      <Stepper steps={VERIFY_STEPS} current={step} />
      <p className="text-[12px] text-muted" aria-live="polite">
        {step === 0
          ? "Sending the label files..."
          : step === 1
            ? "Reading every field printed on the label..."
            : "Comparing the label against the application..."}
      </p>
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="flex min-h-[300px] items-center justify-center rounded-card border border-dashed border-line bg-surface/40 text-center">
      <div className="max-w-[280px] text-[13px] leading-relaxed text-muted">
        Verify an application + label set, or upload full COLA applications, and results will appear here.
      </div>
    </div>
  );
}

function FullPdfResults({
  rows,
  done,
  errors,
  activeRow,
  onSelect,
}: {
  rows: FullPdfRow[];
  done: number;
  errors: number;
  activeRow: FullPdfRow | null;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) return <EmptyResults />;
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Full application results</h2>
          <span className="text-[12px] text-muted">
            {done}/{rows.length} complete{errors ? ` · ${errors} failed` : ""}
          </span>
        </div>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className={
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition " +
                  (activeRow?.id === row.id
                    ? "border-accent/50 bg-accent/5"
                    : "border-line-2 bg-card hover:border-accent/35 hover:bg-surface")
                }
              >
                <FileKindIcon kind={row.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-2">{row.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {row.state.kind === "done"
                      ? row.state.application.brandName
                      : row.state.kind === "error"
                        ? row.state.message
                        : row.state.kind === "running"
                          ? "Reading and verifying..."
                          : "Ready"}
                  </span>
                </span>
                <FullRowStatus row={row} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {activeRow?.state.kind === "done" ? (
        <ResultPanel result={activeRow.state.result} />
      ) : activeRow?.state.kind === "running" ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-card border border-dashed border-line bg-surface/40 text-center text-[13px] text-muted">
          Reading application fields and label text from {activeRow.name}...
        </div>
      ) : activeRow?.state.kind === "error" ? (
        <div className="rounded-card border border-accent-red/30 bg-accent-red/5 p-4 text-[13px] text-accent-red">
          {activeRow.state.message}
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center rounded-card border border-dashed border-line bg-surface/40 text-center text-[13px] text-muted">
          Select Verify full applications to process this file.
        </div>
      )}
    </div>
  );
}

function FileKindIcon({ kind }: { kind: LabelFileKind }) {
  return kind === "pdf" ? <FilePdf size={18} /> : <ImageIcon size={18} />;
}

function FullRowStatus({ row }: { row: FullPdfRow }) {
  if (row.state.kind === "done") {
    return (
      <Badge className="border-accent-green/40 bg-accent-green/10 text-accent-green">
        {row.state.result.report.matchPercentage}%
      </Badge>
    );
  }
  if (row.state.kind === "running") {
    return <Badge className="border-accent-blue/40 bg-accent-blue/10 text-accent-blue">running</Badge>;
  }
  if (row.state.kind === "error") {
    return <Badge className="border-accent-red/40 bg-accent-red/10 text-accent-red">failed</Badge>;
  }
  return <Badge>ready</Badge>;
}

function FileUploadBox({
  inputRef,
  accept,
  label,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  label: string;
  onFiles: (files: FileList | File[] | null) => void | Promise<void>;
}) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-surface/60 py-7 text-muted transition hover:border-accent/50 hover:text-ink-2 focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
        }}
      >
        <ImageIcon />
        <span className="text-[13px] font-medium">{label}</span>
      </button>
    </>
  );
}

function FileTiles({ files, onRemove }: { files: LabelFile[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {files.map((file) => (
        <div key={file.id} className="group relative">
          {file.kind === "pdf" ? (
            <div className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-center text-ink-2 shadow-card">
              <FilePdf size={22} />
              <span className="text-[11px] font-semibold uppercase text-accent-red">PDF</span>
              <span className="w-full truncate text-[10.5px] text-muted" title={file.name}>
                {file.name}
              </span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.dataUrl}
              alt={file.name}
              className="h-28 rounded-lg border border-line object-contain shadow-card"
            />
          )}
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => onRemove(file.id)}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white opacity-0 shadow-pop transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 group-hover:opacity-100"
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

async function readLabelFile(file: File): Promise<LabelFile> {
  const dataUrl = await fileToDataUrl(file);
  return {
    id: fileId(file),
    name: file.name,
    dataUrl,
    kind: isPdfDataUrl(dataUrl) ? "pdf" : "image",
    size: file.size,
  };
}

function readFullApplicationFile(file: File): FullApplicationFile {
  return {
    id: fileId(file),
    name: file.name,
    file,
    kind: inferSupportedLabelMime(file) === "application/pdf" ? "pdf" : "image",
    size: file.size,
  };
}

function fileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
}
