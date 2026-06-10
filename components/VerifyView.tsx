"use client";

import { useRef, useState } from "react";
import Card from "@/components/house/Card";
import IconButton from "@/components/house/IconButton";
import Chip from "@/components/house/Chip";
import Stepper from "@/components/house/Stepper";
import { Sparkles, Image as ImageIcon, X as XIcon, Bolt } from "@/components/house/icons";
import ApplicationForm from "@/components/ApplicationForm";
import ResultPanel from "@/components/ResultPanel";
import { ColaApplication, VerifyResponse } from "@/lib/contract";
import { OTIUM_APPLICATION } from "@/lib/fixtures";
import { fileToDataUrl, verifyCase } from "@/lib/client";

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
}

export default function VerifyView() {
  const [application, setApplication] = useState<ColaApplication>(EMPTY_APPLICATION);
  const [images, setImages] = useState<LabelImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    try {
      const added = await Promise.all(
        Array.from(files)
          .slice(0, 4 - images.length)
          .map(async (f) => ({ name: f.name, dataUrl: await fileToDataUrl(f) }))
      );
      setImages((prev) => [...prev, ...added].slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the image file.");
    }
  };

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
          return { name, dataUrl: await fileToDataUrl(file) };
        })
      );
      setImages(imgs);
    } catch {
      setError("Could not load the sample label images.");
    }
  };

  const canVerify =
    !busy &&
    images.length > 0 &&
    application.brandName.trim() !== "" &&
    application.classType.trim() !== "" &&
    application.alcoholContent.trim() !== "" &&
    application.netContents.trim() !== "" &&
    application.applicantNameAddress.trim() !== "";

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
          <ApplicationForm value={application} onChange={setApplication} />
        </Card>

        <Card>
          <h2 className="mb-1 text-[15px] font-semibold">Label images</h2>
          <p className="mb-3 text-[12px] text-muted">
            Up to 4 images of one container — front, back, neck. The government warning is
            usually on the back label.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
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
            <span className="text-[13px] font-medium">Click or drop label images</span>
          </button>
          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {images.map((img, i) => (
                <div key={img.name + i} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-28 rounded-lg border border-line object-contain shadow-card"
                  />
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
                ? "Sending the label images…"
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
              Fill in the application, add the label images, and the match report will appear
              here — typically in about 5 seconds.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
