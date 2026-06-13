"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon } from "@/components/house/icons";

/**
 * Accessible upload target for the Batch Intake screen (Stage 7 Wave 2).
 *
 * Deliberately dead-simple for non-technical, older reviewers (R4): one big,
 * obvious drop area that is ALSO a real button (Enter/Space open the file
 * picker), a visible heading label (the placeholder text is never the only
 * label), the accepted file types spelled out, and a ≥44px target. Drag-drop is
 * a convenience on top of the always-available file picker — never the only way
 * to add files.
 *
 * Pure presentation + input wiring: it hands raw `File`s up via `onFiles` and
 * owns no upload state. The parent (IntakeWorkspace) does the network work.
 */
export default function UploadDropzone({
  onFiles,
  disabled = false,
  busy = false,
}: {
  onFiles: (files: File[]) => void;
  /** Disable the target (e.g. after the batch has started). */
  disabled?: boolean;
  /** Uploads in flight — keeps the target usable but signals work is happening. */
  busy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  const open = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  return (
    <div>
      <label
        htmlFor="intake-file-input"
        className="mb-2 block text-[13px] font-semibold text-ink"
      >
        Add your application and label files
      </label>

      <input
        id="intake-file-input"
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={open}
        disabled={disabled}
        aria-describedby="intake-accepted-types"
        className={
          "flex min-h-[112px] w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-7 text-center transition " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
          "disabled:cursor-not-allowed disabled:opacity-50 " +
          (dragging
            ? "border-accent bg-accent/5 text-ink"
            : "border-line bg-surface/60 text-muted hover:border-accent/50 hover:text-ink-2")
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          emit(e.dataTransfer.files);
        }}
      >
        <ImageIcon size={22} />
        <span className="text-[14px] font-medium text-ink-2">
          {busy
            ? "Uploading your files…"
            : "Drag files here, or click to choose"}
        </span>
        <span className="text-[12px] text-muted">
          You can add more files at any time — duplicates are skipped.
        </span>
      </button>

      <p
        id="intake-accepted-types"
        className="mt-2 text-[12px] text-muted"
      >
        Accepted file types: PDF, PNG, JPG. Name files like
        <span className="mx-1 font-mono text-[11.5px] text-ink-2">
          case001_application.pdf
        </span>
        and
        <span className="mx-1 font-mono text-[11.5px] text-ink-2">
          case001_label.png
        </span>
        so they pair up automatically.
      </p>
    </div>
  );
}
