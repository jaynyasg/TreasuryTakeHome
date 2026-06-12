"use client";

import {
  ApiError,
  ApplicationExtractResponse,
  ColaApplication,
  ColaPrefillResponse,
  StageEvent,
  VerifyResponse,
} from "@/lib/contract";
import { ensureSupportedDataUrlMime } from "@/lib/labelFiles";

/** Fetch a COLA application from the public registry (live, or cached fixture). */
export async function fetchColaPrefill(ttbid: string): Promise<ColaPrefillResponse> {
  const res = await fetch(`/api/cola/${encodeURIComponent(ttbid)}`);
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error : `Registry lookup failed (${res.status})`);
  }
  const parsed = ColaPrefillResponse.safeParse(json);
  if (!parsed.success) throw new Error("Server response violated the contract.");
  return parsed.data;
}

/** Extract Form 5100.31 fields from uploaded COLA application files. */
export async function extractApplicationFromFiles(fileDataUrls: string[]): Promise<ColaApplication> {
  let res: Response;
  try {
    res = await fetch("/api/extract-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileDataUrls }),
    });
  } catch {
    throw new Error("Network error — could not reach the server.");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error : `Application extraction failed (${res.status})`);
  }
  const parsed = ApplicationExtractResponse.safeParse(json);
  if (!parsed.success) throw new Error("Server response violated the contract.");
  return parsed.data.application;
}

export const extractApplicationFromPdfs = extractApplicationFromFiles;

export type VerifyStage = StageEvent["stage"];

/** Typed failure crossing the client seam — carries the server's retryability verdict. */
export class VerifyError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "VerifyError";
    this.retryable = retryable;
  }
}

const MAX_ATTEMPTS = 3; // 1 initial + 2 retries on retryable failures
const RETRY_BASE_MS = 600;

function retryDelayMs(attempt: number): number {
  // Linear backoff with jitter: ~0.6-1.2s, then ~1.2-2.4s.
  return RETRY_BASE_MS * attempt * (1 + Math.random());
}

/**
 * Client-side seam: every server payload is parsed against the contract.
 * Retryable failures (429/5xx/timeout — server-classified) are retried here,
 * inside the seam, so single verify and batch runs heal identically.
 */
export async function verifyCase(
  application: ColaApplication,
  imageDataUrls: string[],
  onStage?: (stage: VerifyStage) => void
): Promise<VerifyResponse> {
  let lastError: VerifyError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await verifyCaseOnce(application, imageDataUrls, onStage);
    } catch (err) {
      if (err instanceof VerifyError && err.retryable && attempt < MAX_ATTEMPTS) {
        lastError = err;
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new VerifyError("Verification failed after retries");
}

async function verifyCaseOnce(
  application: ColaApplication,
  imageDataUrls: string[],
  onStage?: (stage: VerifyStage) => void
): Promise<VerifyResponse> {
  let res: Response;
  try {
    res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, imageDataUrls }),
    });
  } catch {
    // Network-level failure before any response — transient by nature.
    throw new VerifyError("Network error — could not reach the server.", true);
  }
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const err = ApiError.safeParse(json);
    throw new VerifyError(
      err.success ? err.data.error : `Request failed (${res.status})`,
      err.success ? (err.data.retryable ?? false) : res.status >= 500
    );
  }
  if (!res.body) throw new VerifyError("Server returned no response body.");

  let terminal: unknown = null;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new VerifyError("Server response violated the contract.");
    }
    const stage = StageEvent.safeParse(obj);
    if (stage.success) {
      onStage?.(stage.data.stage);
      return;
    }
    terminal = obj;
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handleLine(buffer);

  const err = ApiError.safeParse(terminal);
  if (err.success) throw new VerifyError(err.data.error, err.data.retryable ?? false);
  const parsed = VerifyResponse.safeParse(terminal);
  if (!parsed.success) throw new VerifyError("Server response violated the contract.");
  return parsed.data;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(ensureSupportedDataUrlMime(String(reader.result), file));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Rasterize an SVG string to a PNG data URL (generated labels -> real vision pipeline). */
export async function svgToPngDataUrl(svg: string, width = 480, height = 660): Promise<string> {
  const canvas = await svgToCanvas(svg, width, height);
  return canvas.toDataURL("image/png");
}

/** Render a generated label to a PDF data URL for the default generated-case artifact. */
export async function svgToPdfDataUrl(svg: string, width = 480, height = 660): Promise<string> {
  return fileToDataUrl(new File([await svgToPdfBlob(svg, width, height)], "label.pdf", { type: "application/pdf" }));
}

export async function svgToPdfBlob(svg: string, width = 480, height = 660): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, height);
  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.94);
  return jpegDataUrlToPdfBlob(jpegDataUrl, width, height);
}

function svgToCanvas(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2; // 2x for legible small print (the warning text)
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize generated label"));
    };
    img.src = url;
  });
}

function jpegDataUrlToPdfBlob(jpegDataUrl: string, width: number, height: number): Blob {
  const image = base64ToBytes(jpegDataUrl.slice(jpegDataUrl.indexOf(",") + 1));
  const content = ascii(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? ascii(part) : part;
    parts.push(bytes);
    offset += bytes.length;
  };
  const object = (id: number, body: string | Uint8Array, prefix = "", suffix = "") => {
    offsets[id] = offset;
    push(`${id} 0 obj\n${prefix}`);
    push(body);
    push(`${suffix}\nendobj\n`);
  };

  push("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  object(
    4,
    image,
    `<< /Type /XObject /Subtype /Image /Width ${width * 2} /Height ${height * 2} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    "\nendstream"
  );
  object(5, content, `<< /Length ${content.length} >>\nstream\n`, "\nendstream");

  const xrefOffset = offset;
  push(
    `xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5]
      .map((id) => `${String(offsets[id]).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  return new Blob(parts.map(bytesToArrayBuffer), { type: "application/pdf" });
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
