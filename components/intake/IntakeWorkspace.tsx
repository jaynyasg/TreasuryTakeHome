"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Card from "@/components/house/Card";
import Badge from "@/components/house/Badge";
import Stepper from "@/components/house/Stepper";
import { Bolt, Check, Image as ImageIcon } from "@/components/house/icons";
import type { ManifestEntry, PreflightSummary } from "@/lib/intake/types";
import UploadDropzone from "./UploadDropzone";
import ManifestTable from "./ManifestTable";
import PreflightPanel from "./PreflightPanel";
import { countProblems } from "./format";

/**
 * Batch Intake workspace (Stage 7 Wave 2) — orchestrates the reviewer flow over
 * the Stage 5 intake API: create/resume a session, upload files into a manifest,
 * preflight, and start a durable batch.
 *
 * Resumability: the idempotency key is generated once and persisted in
 * `sessionStorage`, so a refresh resumes the SAME intake session (the create
 * route returns the existing session for a repeated key) and re-fetches its
 * manifest + preflight. The created session id is persisted alongside it.
 *
 * Client/server boundary: every network call is a client fetch to the existing
 * intake API, which already owns auth, flag-gating, and storage. Responses are
 * parsed defensively (parse-or-fallback) — we never trust the shape.
 */

const STEPS = [
  { label: "Upload", icon: <ImageIcon /> },
  { label: "Preflight", icon: <Check /> },
  { label: "Start", icon: <Bolt /> },
];

const STORAGE_KEY = "ttb.intake.session.v1";

interface PersistedSession {
  idempotencyKey: string;
  sessionId: string | null;
}

interface StartedBatch {
  batchId: string;
  caseCount: number;
}

/** A per-file upload-in-flight indicator shown while POSTs are pending. */
interface PendingUpload {
  name: string;
}

function generateKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `intake-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readPersisted(): PersistedSession {
  if (typeof window === "undefined") {
    return { idempotencyKey: generateKey(), sessionId: null };
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as PersistedSession).idempotencyKey === "string"
      ) {
        const p = parsed as PersistedSession;
        return {
          idempotencyKey: p.idempotencyKey,
          sessionId: typeof p.sessionId === "string" ? p.sessionId : null,
        };
      }
    }
  } catch {
    // fall through to a fresh key
  }
  return { idempotencyKey: generateKey(), sessionId: null };
}

function persist(session: PersistedSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage may be unavailable (private mode); resumability degrades
    // gracefully to in-memory only.
  }
}

/** Defensive: pull a manifest array out of an unknown JSON payload. */
function parseManifest(payload: unknown): ManifestEntry[] | null {
  if (!payload || typeof payload !== "object") return null;
  const manifest = (payload as { manifest?: unknown }).manifest;
  if (!Array.isArray(manifest)) return null;
  const entries: ManifestEntry[] = [];
  for (const raw of manifest) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    // The files route returns DB rows (snake_case); tolerate both shapes.
    const fileName = pickString(r.file_name ?? r.fileName);
    const caseKey = pickString(r.case_key ?? r.caseKey);
    const status = pickString(r.status);
    const kind = pickString(r.kind);
    if (!fileName || !status || !kind) continue;
    entries.push({
      fileName,
      kind: isKind(kind) ? kind : "unknown",
      caseKey: caseKey ?? "",
      checksum: pickString(r.checksum) ?? "",
      size: pickNumber(r.size_bytes ?? r.size) ?? 0,
      contentType: pickString(r.content_type ?? r.contentType) ?? "",
      status: isStatus(status) ? status : "uploaded",
    });
  }
  return entries;
}

function isKind(value: string): value is ManifestEntry["kind"] {
  return value === "application" || value === "label" || value === "unknown";
}

function isStatus(value: string): value is ManifestEntry["status"] {
  return (
    value === "uploaded" ||
    value === "missing" ||
    value === "invalid" ||
    value === "duplicate" ||
    value === "excluded"
  );
}

function pickString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Defensive: pull a PreflightSummary out of an unknown JSON payload. */
function parseSummary(payload: unknown): PreflightSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const s = (payload as { summary?: unknown }).summary;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  return {
    totalFiles: pickNumber(o.totalFiles) ?? 0,
    completeCases: pickNumber(o.completeCases) ?? 0,
    incompleteCases: pickNumber(o.incompleteCases) ?? 0,
    duplicates: pickNumber(o.duplicates) ?? 0,
    unsupported: pickNumber(o.unsupported) ?? 0,
    estimatedCostUsd: pickNumber(o.estimatedCostUsd) ?? 0,
    estimatedMinutes: pickNumber(o.estimatedMinutes) ?? 0,
    issues: Array.isArray(o.issues)
      ? (o.issues.filter(
          (i): i is PreflightSummary["issues"][number] =>
            Boolean(i) && typeof i === "object" && typeof (i as { message?: unknown }).message === "string"
        ) as PreflightSummary["issues"])
      : [],
  };
}

/** Read a server error message defensively, falling back to a friendly default. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const msg = (body as { error?: unknown }).error;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  } catch {
    // ignore — use fallback
  }
  return fallback;
}

export default function IntakeWorkspace() {
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [summary, setSummary] = useState<PreflightSummary | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [startError, setStartError] = useState<string | null>(null);

  const [bootstrapping, setBootstrapping] = useState(true);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<StartedBatch | null>(null);

  // Guards a single in-flight create call so refresh/double-mount can't mint
  // two sessions before the idempotency key round-trips.
  const ensuringRef = useRef<Promise<string | null> | null>(null);

  const refreshPreflight = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/intake/${id}/preflight`, { method: "GET" });
      if (!res.ok) return;
      setSummary(parseSummary(await res.json()));
    } catch {
      // Non-fatal: the manifest still reflects what was uploaded.
    }
  }, []);

  /** Create-or-resume the intake session; returns the session id or null. */
  const ensureSession = useCallback(
    async (key: string, knownId: string | null): Promise<string | null> => {
      if (knownId) return knownId;
      if (ensuringRef.current) return ensuringRef.current;

      const run = (async (): Promise<string | null> => {
        try {
          const res = await fetch("/api/intake", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idempotencyKey: key }),
          });
          if (!res.ok) {
            setSessionError(
              await errorMessage(
                res,
                "Could not start an intake session. Refresh to try again."
              )
            );
            return null;
          }
          const body: unknown = await res.json();
          const id =
            body && typeof body === "object"
              ? pickString((body as { session?: { id?: unknown } }).session?.id)
              : null;
          if (!id) {
            setSessionError("The server did not return a session id.");
            return null;
          }
          setSessionId(id);
          persist({ idempotencyKey: key, sessionId: id });
          return id;
        } catch {
          setSessionError(
            "Network error starting the intake session. Check your connection and refresh."
          );
          return null;
        } finally {
          ensuringRef.current = null;
        }
      })();

      ensuringRef.current = run;
      return run;
    },
    []
  );

  // Bootstrap: load (or generate) the persisted key, resume the session if one
  // exists, and hydrate its manifest + preflight so a refresh continues cleanly.
  useEffect(() => {
    const persisted = readPersisted();
    setIdempotencyKey(persisted.idempotencyKey);
    persist(persisted);

    (async () => {
      if (persisted.sessionId) {
        setSessionId(persisted.sessionId);
        setResumed(true);
        await refreshPreflight(persisted.sessionId);
      }
      setBootstrapping(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadOne = useCallback(
    async (id: string, file: File): Promise<void> => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/intake/${id}/files`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const msg = await errorMessage(
          res,
          `Couldn't upload ${file.name}. Try again.`
        );
        throw new Error(msg);
      }
      const parsed = parseManifest(await res.json());
      if (parsed) setManifest(parsed);
    },
    []
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || started) return;
      setUploadErrors([]);
      setStartError(null);

      const id = await ensureSession(idempotencyKey, sessionId);
      if (!id) return; // session error already surfaced

      setPending(files.map((f) => ({ name: f.name })));
      const failures: string[] = [];
      // Sequential: the dedupe/manifest in the API is per-session and each
      // response returns the full manifest, so serial keeps state coherent.
      for (const file of files) {
        try {
          await uploadOne(id, file);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `Couldn't upload ${file.name}.`);
        } finally {
          setPending((prev) => prev.filter((p) => p.name !== file.name));
        }
      }
      setPending([]);
      if (failures.length > 0) setUploadErrors(failures);
      await refreshPreflight(id);
    },
    [ensureSession, idempotencyKey, refreshPreflight, sessionId, started, uploadOne]
  );

  const handleStart = useCallback(async () => {
    if (!sessionId || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/intake/${sessionId}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        setStartError(
          await errorMessage(
            res,
            "Could not start the batch. Review the files above and try again."
          )
        );
        return;
      }
      const body: unknown = await res.json();
      const o =
        body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const batchId = pickString(o.batchId);
      if (!batchId) {
        setStartError("The batch started but the server did not return its id.");
        return;
      }
      setStarted({ batchId, caseCount: pickNumber(o.caseCount) ?? 0 });
      // Resumability: this session is now consumed. Clear it so a fresh batch
      // starts with a new idempotency key next time.
      persist({ idempotencyKey: generateKey(), sessionId: null });
    } catch {
      setStartError(
        "Network error starting the batch. Your files are safe — try Start again."
      );
    } finally {
      setStarting(false);
    }
  }, [sessionId, starting]);

  // Stepper position: 0 upload, 1 preflight (files present), 2 started.
  const step = started ? 2 : manifest.length > 0 ? 1 : 0;
  const problems = countProblems(manifest);

  if (started) {
    return <StartedView batch={started} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <Stepper steps={STEPS} current={step} className="self-start" />

      {resumed && !bootstrapping && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-blue/30 bg-accent-blue/5 px-3 py-2 text-[12.5px] text-ink-2">
          <Badge className="border-accent-blue/40 bg-accent-blue/10 text-accent-blue">
            Resumed
          </Badge>
          <span>
            We picked up your earlier draft. Already-uploaded files are kept;
            adding them again is safely skipped.
          </span>
        </div>
      )}

      {sessionError && (
        <p className="rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[12.5px] text-accent-red">
          {sessionError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left column: upload + manifest. */}
        <div className="space-y-5">
          <Card>
            <UploadDropzone
              onFiles={handleFiles}
              busy={pending.length > 0}
              disabled={bootstrapping}
            />
            {pending.length > 0 && (
              <ul
                className="mt-3 space-y-1.5"
                aria-live="polite"
                aria-label="Files uploading"
              >
                {pending.map((p) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-2 text-[12px] text-muted"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                    <span className="truncate">Uploading {p.name}…</span>
                  </li>
                ))}
              </ul>
            )}
            {uploadErrors.length > 0 && (
              <div className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
                <p className="text-[12px] font-semibold text-accent-red">
                  Some files were not added:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {uploadErrors.map((e, i) => (
                    <li key={i} className="text-[11.5px] text-accent-red">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Your files</h2>
              {manifest.length > 0 && (
                <span className="text-[12px] text-muted">
                  {manifest.length} file{manifest.length === 1 ? "" : "s"}
                  {problems > 0 ? ` · ${problems} need attention` : ""}
                </span>
              )}
            </div>
            {manifest.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line bg-surface/40 px-3 py-6 text-center text-[12.5px] text-muted">
                {bootstrapping
                  ? "Loading your draft…"
                  : "No files yet. Add your application and label files above to begin."}
              </p>
            ) : (
              <ManifestTable entries={manifest} />
            )}
          </Card>
        </div>

        {/* Right column: preflight + start. Sticky on tablet/desktop so the
            primary action is always reachable (responsive spec). */}
        <div className="lg:sticky lg:top-5 lg:self-start">
          <PreflightPanel
            summary={summary}
            starting={starting}
            onStart={handleStart}
            startError={startError}
          />
        </div>
      </div>
    </div>
  );
}

function StartedView({ batch }: { batch: StartedBatch }) {
  return (
    <div className="flex flex-col gap-5">
      <Stepper steps={STEPS} current={2} className="self-start" />
      <Card>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent-green/40 bg-accent-green/10 text-accent-green">
            <Check size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Batch started</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {batch.caseCount} case{batch.caseCount === 1 ? "" : "s"} queued for
              processing. You can close this tab — the work continues without
              you and shows up in your Work Queue.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className="font-mono">{batch.batchId}</Badge>
            </div>
            <div className="mt-4">
              <Link
                href="/reviewer/queue"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-ink px-4 text-[13px] font-medium text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:bg-[#2c2620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
              >
                Go to Work Queue
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
