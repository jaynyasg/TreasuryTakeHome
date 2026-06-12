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
import { fetchColaPrefill, fileToDataUrl, verifyCase } from "@/lib/client";
import {
  ACCEPTED_LABEL_FILE_TYPES,
  formatBytes,
  isPdfDataUrl,
  isSupportedLabelFile,
  MAX_LABEL_FILES,
  MAX_LABEL_UPLOAD_BYTES,
} from "@/lib/labelFiles";

/** Steps mirror the real pipeline; advancement is driven by server stage events. */
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
/** Same COLA, photographed badly (perspective skew) — demos honest needs_review. */
const DEGRADED_SAMPLE_IMAGES = [
  "/samples/degraded-otium-front.jpg",
  "/samples/degraded-otium-back.jpg",
];

interface LabelImage {
  name: string;
  dataUrl: string;
  kind: "image" | "pdf";
  size: number;
}

export default function VerifyView() {
  const [application, setApplication] = useState<ColaApplication>(EMPTY_APPLICATION);
  const [images, setImages] = useState<LabelImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [ttbId, setTtbId] = useState("");
  const [colaBusy, setColaBusy] = useState(false);
  const [colaSource, setColaSource] = useState<"live" | "cached" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const prefillFromRegistry = async (id: string) => {
    setColaBusy(true);
    setColaSource(null);
    setError(null);
    try {
      const prefill = await fetchColaPrefill(id.trim());
      setApplication(prefill.application);
      setColaSource(prefill.source);
      setTtbId(prefill.ttbid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registry lookup failed.");
    } finally {
      setColaBusy(false);
    }
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    setError(null);
    try {
      const supported = Array.from(files).filter(isSupportedLabelFile);
      if (supported.length === 0) {
        setError("Add a PDF, PNG, JPEG, or WebP label file.");
        return;
      }
      const remainingSlots = MAX_LABEL_FILES - images.length;
      if (remainingSlots <= 0) {
        setError(`Remove a label file before adding another one. This prototype accepts up to ${MAX_LABEL_FILES}.`);
        return;
      }
      const nextFiles = supported.slice(0, remainingSlots);
      const totalBytes =
        images.reduce((sum, file) => sum + file.size, 0) +
        nextFiles.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_LABEL_UPLOAD_BYTES) {
        setError(
          `Selected label files total ${formatBytes(totalBytes)}. Use a PDF or image set under ${formatBytes(MAX_LABEL_UPLOAD_BYTES)}.`
        );
        return;
      }
      const added = await Promise.all(
        nextFiles.map(async (f) => {
          const dataUrl = await fileToDataUrl(f);
          return { name: f.name, dataUrl, kind: labelFileKind(dataUrl), size: f.size };
        })
      );
      setImages((prev) => [...prev, ...added].slice(0, MAX_LABEL_FILES));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the label file.");
    }
  };

  // AC-6: Ctrl+V a screenshot straight onto the Verify tab.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const labelFiles = items
        .filter((i) => i.type.startsWith("image/") || i.type === "application/pdf")
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null && isSupportedLabelFile(f));
      if (labelFiles.length === 0) return;
      e.preventDefault();
      void addFiles(labelFiles);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const loadSample = async (imageUrls: string[]) => {
    setError(null);
    setResult(null);
    setApplication(SAMPLE_APPLICATION);
    try {
      const imgs = await Promise.all(
        imageUrls.map(async (url) => {
          const blob = await fetch(url).then((r) => r.blob());
          const name = url.split("/").pop()!;
          const file = new File([blob], name, { type: blob.type || "image/jpeg" });
          const dataUrl = await fileToDataUrl(file);
          return { name, dataUrl, kind: labelFileKind(dataUrl), size: file.size };
        })
      );
      setImages(imgs);
    } catch {
      setError("Could not load the sample label files.");
    }
  };

  // ABV/net are optional: 2023-edition forms omit them (presence-only checks).
  const canVerify =
    !busy &&
    images.length > 0 &&
    application.brandName.trim() !== "" &&
    application.classType.trim() !== "" &&
    application.applicantNameAddress.trim() !== "";
  const verifyDisabledReason =
    busy || canVerify
      ? null
      : images.length === 0
        ? "Add a PDF or image label file to verify."
        : "Complete brand, class/type, and applicant fields to verify.";

  const onVerify = async () => {
    setBusy(true);
    setStep(0);
    setError(null);
    setResult(null);
    try {
      setResult(
        await verifyCase(application, images.map((i) => i.dataUrl), (stage) =>
          setStep(stage === "extracting" ? 1 : 2)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Application (Form 5100.31)</h2>
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
              {colaBusy ? "Fetching…" : "Fetch"}
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
        </Card>

        <Card>
          <h2 className="mb-1 text-[15px] font-semibold">Label files</h2>
          <p className="mb-3 text-[12px] text-muted">
            Up to {MAX_LABEL_FILES} PDFs or images of one container — front, back, neck. The
            government warning is usually on the back label.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_LABEL_FILE_TYPES}
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-surface/60 py-8 text-muted transition hover:border-accent/50 hover:text-ink-2 focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
            }}
          >
            <ImageIcon />
            <span className="text-[13px] font-medium">Click, drop, or paste label files</span>
          </button>
          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {images.map((img, i) => (
                <div key={img.name + i} className="group relative">
                  {img.kind === "pdf" ? (
                    <div className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-2 text-center text-ink-2 shadow-card">
                      <FilePdf size={22} />
                      <span className="text-[11px] font-semibold uppercase text-accent-red">PDF</span>
                      <span className="w-full truncate text-[10.5px] text-muted" title={img.name}>
                        {img.name}
                      </span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-28 rounded-lg border border-line object-contain shadow-card"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${img.name}`}
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white opacity-0 shadow-pop transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 group-hover:opacity-100"
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <IconButton
              icon={<Sparkles />}
              loading={busy}
              disabled={!canVerify}
              onClick={() => void onVerify()}
            >
              {busy ? "Verifying…" : "Verify label"}
            </IconButton>
            {verifyDisabledReason && (
              <p className="mt-2 text-[11.5px] text-muted">{verifyDisabledReason}</p>
            )}
          </div>
          {error && (
            <p className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[12.5px] text-accent-red">
              {error}
            </p>
          )}
        </Card>
      </div>

      <div>
        {busy ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-card border border-dashed border-line bg-surface/40 px-4 text-center">
            <Stepper steps={VERIFY_STEPS} current={step} />
            <p className="text-[12px] text-muted" aria-live="polite">
              {step === 0
                ? "Sending the label files…"
                : step === 1
                  ? "Reading every field printed on the label…"
                  : "Comparing the label against the application…"}
            </p>
          </div>
        ) : result ? (
          <ResultPanel result={result} />
        ) : (
          <div className="flex min-h-[300px] items-center justify-center rounded-card border border-dashed border-line bg-surface/40 text-center">
            <div className="max-w-[260px] text-[13px] leading-relaxed text-muted">
              Fill in the application, add the label files, and the match report will appear
              here — typically in about 5 seconds.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function labelFileKind(dataUrl: string): LabelImage["kind"] {
  return isPdfDataUrl(dataUrl) ? "pdf" : "image";
}
