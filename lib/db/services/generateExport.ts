import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db/client";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { MatchReport, type VerifyResponse } from "@/lib/contract";

import { listCasesByBatch, type CaseRow } from "@/lib/db/repositories/cases";
import { getLatestVerdict } from "@/lib/db/repositories/verdicts";
import {
  insertExport,
  setExportStatus,
  type ExportRow,
  type ExportStatus,
} from "@/lib/db/repositories/exports";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import { buildBatchCsv, type BatchCsvRow } from "@/lib/csv";

/** Arguments to {@link generateExport}. */
export interface GenerateExportArgs {
  /** Batch whose cases are exported. */
  batchId: string;
  /** Reviewer/admin who requested the export (recorded on the row + audit). */
  requestedBy: string;
  /** Ruleset versions in effect at snapshot time (compliance versioning, R6). */
  rulesetVersions?: string[] | null;
  /** Trace id propagated into the audit event. */
  traceId?: string | null;
}

/** Result of a successful export generation. */
export interface GenerateExportResult {
  exportId: string;
  objectKey: string;
  status: ExportStatus;
  /** Every case in the batch at snapshot time (clean, mismatch, failed, pending). */
  includedCaseIds: string[];
}

/** Content type for the generated CSV artifact. */
const CSV_CONTENT_TYPE = "text/csv";

/**
 * Case states still mid-flight at snapshot time. If ANY case is in one of these,
 * the export is a `partial` point-in-time snapshot (some results may still
 * change); otherwise it is `complete`. A failed/needs_review/scored case is a
 * settled-enough row to be `complete` — exports must still include them.
 */
const IN_PROGRESS_CASE_STATES: ReadonlySet<CaseRow["status"]> = new Set([
  "draft",
  "queued",
  "extracting",
  "scoring",
  "retry_wait",
  "dead_letter",
]);

/**
 * Service-command: generate a POINT-IN-TIME export of a batch (plan "Export
 * semantics": "exports are point-in-time snapshot records with timestamp,
 * requester, included case IDs/statuses, ruleset versions, completion/partial
 * label, and a stable generated artifact").
 *
 * Snapshot semantics:
 *   - Reads ALL cases in the batch — clean matches, mismatches, failed, AND
 *     still-processing cases. Exports must include every case (plan "Accepted
 *     Scope": "Exports that include every case").
 *   - The set of included case ids + their statuses is captured at snapshot time
 *     and stored on the export row, so the artifact remains an accurate record
 *     even if cases change afterward. A new export is a NEW snapshot — that is
 *     correct, exports are point-in-time, not idempotent.
 *   - `complete` when every case has settled; `partial` when at least one case
 *     is still processing (the artifact still includes those cases, marked by
 *     their current status).
 *
 * Order of operations (mirrors the worker's blob-then-commit discipline):
 *   1. Snapshot cases + latest verdicts and build the CSV bytes.
 *   2. Insert the export row (status `generating`) inside a transaction with its
 *      audit event, capturing included case ids + ruleset versions.
 *   3. Write the CSV blob to storage (outside the txn).
 *   4. Mark the export `complete`/`partial` with its object key.
 * The blob write happens before the terminal status is set, so a `complete`
 * export always has a retrievable artifact.
 */
export async function generateExport(
  db: DbClient,
  storage: StorageAdapter,
  args: GenerateExportArgs
): Promise<GenerateExportResult> {
  const exportId = randomUUID();
  const objectKey = `exports/${args.batchId}/${exportId}.csv`;
  const traceId = args.traceId ?? null;
  const rulesetVersions = args.rulesetVersions ?? null;

  // 1. Point-in-time snapshot: ALL cases in the batch, plus each case's latest
  //    verdict. Capture ids + statuses now so the row records exactly what was
  //    exported.
  const cases = await listCasesByBatch(db, args.batchId);
  const includedCaseIds = cases.map((c) => c.id);

  const csvRows: BatchCsvRow[] = [];
  for (const c of cases) {
    const verdict = await getLatestVerdict(db, c.id);
    csvRows.push(caseToCsvRow(c, verdict?.payload));
  }
  const csv = buildBatchCsv(csvRows);

  const anyInProgress = cases.some((c) => IN_PROGRESS_CASE_STATES.has(c.status));
  const status: Extract<ExportStatus, "complete" | "partial"> = anyInProgress
    ? "partial"
    : "complete";

  // 2. Insert the export row + audit event in one unit of work. The row starts
  //    `generating`; the included ids/statuses snapshot is persisted up front.
  await db.transaction(async (tx) => {
    await insertExport(tx, {
      id: exportId,
      batchId: args.batchId,
      requestedBy: args.requestedBy,
      includedCaseIds,
      rulesetVersions,
    });

    await appendAuditEvent(tx, {
      id: randomUUID(),
      actorUserId: args.requestedBy,
      action: "export.generate",
      aggregateType: "batch",
      aggregateId: args.batchId,
      afterSummary: {
        exportId,
        caseCount: includedCaseIds.length,
        includedStatuses: cases.map((c) => ({ id: c.id, status: c.status })),
        status,
        rulesetVersions,
      },
      traceId,
    });
  });

  // 3. Write the artifact bytes BEFORE marking the export terminal, so a
  //    `complete`/`partial` export always has a retrievable blob.
  await storage.put(objectKey, new TextEncoder().encode(csv), {
    contentType: CSV_CONTENT_TYPE,
  });

  // 4. Mark the export terminal with its object key.
  await setExportStatus(db, exportId, status, { objectKey });

  return { exportId, objectKey, status, includedCaseIds };
}

// --- helpers ---------------------------------------------------------------

/**
 * Map a case + its latest verdict payload onto a {@link BatchCsvRow} the shared
 * CSV builder understands. A case with no verdict (failed/pending/needs_review
 * before scoring) becomes a row with `result: null` so it still appears in the
 * export — every case is included, with empty result columns when unscored.
 */
function caseToCsvRow(c: CaseRow, verdictPayload: unknown): BatchCsvRow {
  const report = parseReport(verdictPayload);
  const result: VerifyResponse | null = report
    ? {
        ok: true,
        // The export only consumes `result.report` + `result.elapsedMs`; the
        // extracted label is not part of the CSV. Supply a minimal valid shell.
        extracted: EMPTY_LABEL,
        report,
        elapsedMs: 0,
      }
    : null;

  return {
    id: c.id,
    kind: "real",
    brand: c.brand ?? "",
    beverageType: c.class_type ?? "",
    defectsInjected: "n/a",
    result,
    // Surface a settled-but-unscored case (failed/needs_review/pending) as the
    // case status in the error column so the row is self-describing.
    error: report ? null : c.status,
  };
}

/** Parse a stored jsonb verdict payload back into a MatchReport, or null. */
function parseReport(payload: unknown): MatchReport | null {
  if (payload == null) return null;
  const parsed = MatchReport.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/**
 * Minimal valid {@link VerifyResponse.extracted} shell. The CSV builder reads
 * only `result.report` and `result.elapsedMs`, never `extracted`, so a contract-
 * valid empty label keeps types honest without inventing label data.
 */
const EMPTY_LABEL: VerifyResponse["extracted"] = {
  brandName: null,
  fancifulName: null,
  classType: null,
  alcoholContent: null,
  netContents: null,
  producerNameAddress: null,
  countryOfOrigin: null,
  wineAppellation: null,
  wineVintage: null,
  governmentWarning: { present: false, text: null, headingStyle: null },
  readability: "clear",
};
