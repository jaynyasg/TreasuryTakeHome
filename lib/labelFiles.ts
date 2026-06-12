export const MAX_LABEL_FILES = 4;
export const MAX_LABEL_UPLOAD_BYTES = 3 * 1024 * 1024;
export const ACCEPTED_LABEL_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/pdf";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

const DATA_URL_MIME = /^data:([^;,]+)(?:;[^,]*)?,/i;

export function isSupportedLabelMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return lower.startsWith("image/") || lower === "application/pdf";
}

export function mimeFromDataUrl(dataUrl: string): string | null {
  return DATA_URL_MIME.exec(dataUrl)?.[1]?.toLowerCase() ?? null;
}

export function isPdfDataUrl(dataUrl: string): boolean {
  return mimeFromDataUrl(dataUrl) === "application/pdf";
}

export function isSupportedLabelDataUrl(dataUrl: string): boolean {
  const mime = mimeFromDataUrl(dataUrl);
  return mime !== null && isSupportedLabelMime(mime);
}

export function inferSupportedLabelMime(file: Pick<File, "name" | "type">): string | null {
  if (file.type && file.type !== "application/octet-stream" && isSupportedLabelMime(file.type)) {
    return file.type.toLowerCase();
  }
  const lowerName = file.name.toLowerCase();
  const ext = Object.keys(MIME_BY_EXTENSION).find((suffix) => lowerName.endsWith(suffix));
  return ext ? MIME_BY_EXTENSION[ext] : null;
}

export function isSupportedLabelFile(file: Pick<File, "name" | "type">): boolean {
  return inferSupportedLabelMime(file) !== null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ensureSupportedDataUrlMime(dataUrl: string, file: Pick<File, "name" | "type">): string {
  if (isSupportedLabelDataUrl(dataUrl)) return dataUrl;
  const inferred = inferSupportedLabelMime(file);
  const comma = dataUrl.indexOf(",");
  if (!inferred || comma < 0) return dataUrl;
  return `data:${inferred};base64,${dataUrl.slice(comma + 1)}`;
}
