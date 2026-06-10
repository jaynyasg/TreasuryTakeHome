"use client";

import {
  ApiError,
  ColaApplication,
  VerifyResponse,
} from "@/lib/contract";

/** Client-side seam: every server response is parsed against the contract. */
export async function verifyCase(
  application: ColaApplication,
  imageDataUrls: string[]
): Promise<VerifyResponse> {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application, imageDataUrls }),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    throw new Error(err.success ? err.data.error : `Request failed (${res.status})`);
  }
  const parsed = VerifyResponse.safeParse(json);
  if (!parsed.success) throw new Error("Server response violated the contract.");
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
