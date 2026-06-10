"use client";

import {
  ApiError,
  ColaApplication,
  StageEvent,
  VerifyResponse,
} from "@/lib/contract";

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
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Rasterize an SVG string to a PNG data URL (generated labels -> real vision pipeline). */
export function svgToPngDataUrl(svg: string, width = 480, height = 660): Promise<string> {
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
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize generated label"));
    };
    img.src = url;
  });
}
