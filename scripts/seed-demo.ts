/**
 * Seed a realistic DEMO BATCH into the real Postgres pointed at by
 * `DATABASE_URL` so a reviewer can exercise the durable-batch UI end to end
 * (Work Queue -> Case Detail -> disposition -> export) WITHOUT running the
 * worker or calling OpenAI. Every durable row the read path needs is written
 * directly here (cases reach review-ready states through LEGAL state-machine
 * transitions; verdict payloads are real `MatchReport`s).
 *
 * Run: npm run seed:demo   (requires DATABASE_URL; run `npm run seed` first so
 * the demo reviewer user exists).
 *
 * NOT part of `npm run verify` — touches a live database.
 *
 * Re-runnable: the batch id is a fixed constant (DEMO_BATCH_ID), and every run
 * first deletes the demo batch's child rows in FK-safe order then re-inserts,
 * so re-running refreshes the demo without piling up duplicates.
 */
// tsx (unlike `next dev`) does not auto-load .env.local, so load it explicitly
// using Next's own env loader before reading DATABASE_URL.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createPgPool } from "@/lib/db/pg";
import { runMigrations } from "@/lib/db/migrate";
import type { DbClient } from "@/lib/db/client";

import { getUserByEmail } from "@/lib/db/repositories/users";
import { insertBatch, setBatchStatus } from "@/lib/db/repositories/batches";
import { insertAssignment } from "@/lib/db/repositories/assignments";
import {
  insertCase,
  setCaseStatus,
  type CaseSeverity,
} from "@/lib/db/repositories/cases";
import { insertCaseFile } from "@/lib/db/repositories/caseFiles";
import { insertExtractedFields } from "@/lib/db/repositories/extractedFields";
import { insertVerdict } from "@/lib/db/repositories/verdicts";
import { insertWarningEvidence } from "@/lib/db/repositories/warningEvidence";

import { applicationToFields } from "@/worker/application";
import type { CaseState } from "@/lib/core/state/case";
import type { ColaApplication, MatchReport } from "@/lib/contract";

/** Demo reviewer the demo batch is assigned to (seeded by `npm run seed`). */
const DEMO_REVIEWER_EMAIL = "reviewer@ttb.gov";

/** Fixed batch id so re-runs target (and refresh) the SAME demo batch. */
const DEMO_BATCH_ID = "demo-batch-0000-0000-0000-000000000001";
const DEMO_BATCH_NAME = "Demo Batch — Spring Importers";

/** A clean-match bourbon application (mirrors the worker harness fixture). */
const CLEAN_MATCH_APPLICATION: ColaApplication = {
  serialNumber: "12345001000123",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  applicantNameAddress: "Old Tom Distillery, Louisville, KY",
};

/** A brand + ABV mismatch variant -> has_mismatches (severity red). */
const MISMATCH_APPLICATION: ColaApplication = {
  serialNumber: "67890002000456",
  beverageType: "wine",
  sourceOfProduct: "imported",
  brandName: "CHÂTEAU MARGAUX",
  classType: "Red Bordeaux Wine",
  alcoholContent: "13.5% Alc./Vol.",
  netContents: "750 mL",
  applicantNameAddress: "Vins du Monde Importers, New York, NY",
  countryOfOrigin: "France",
  wineAppellation: "Margaux",
  wineVintage: "2018",
};

/** A warning-uncertain variant -> needs_review (severity amber). */
const NEEDS_REVIEW_APPLICATION: ColaApplication = {
  serialNumber: "24680003000789",
  beverageType: "malt_beverage",
  sourceOfProduct: "domestic",
  brandName: "RIVER BEND BREWING",
  classType: "India Pale Ale",
  alcoholContent: "6.8% Alc./Vol.",
  netContents: "355 mL",
  applicantNameAddress: "River Bend Brewing Co., Portland, OR",
};

/** A demo case spec: how to seed it and the verdict/severity it lands on. */
interface DemoCaseSpec {
  caseId: string;
  application: ColaApplication;
  /** Final review-ready case state. */
  finalState: Extract<
    CaseState,
    "clean_match" | "has_mismatches" | "needs_review"
  >;
  severity: CaseSeverity;
  report: MatchReport;
  /** Insert a warning_evidence row (the needs_review case). */
  warning?: {
    leadInDetected: boolean;
    boldnessConfidence: number;
    uncertaintyReason: string;
    verdict: string;
  };
}

const DEMO_CASES: DemoCaseSpec[] = [
  {
    caseId: "demo-case-clean-0000000000000001",
    application: CLEAN_MATCH_APPLICATION,
    finalState: "clean_match",
    severity: "green",
    report: {
      matchPercentage: 100,
      overall: "all_match",
      summary: "All fields match the label. Government warning present and exact.",
      verdicts: [
        {
          field: "brandName",
          status: "match",
          applicationValue: "OLD TOM DISTILLERY",
          labelValue: "OLD TOM DISTILLERY",
          reason: "Brand name matches exactly after normalization.",
        },
        {
          field: "classType",
          status: "match",
          applicationValue: "Kentucky Straight Bourbon Whiskey",
          labelValue: "Kentucky Straight Bourbon Whiskey",
          reason: "Class/type designation matches.",
        },
        {
          field: "alcoholContent",
          status: "match",
          applicationValue: "45% Alc./Vol. (90 Proof)",
          labelValue: "45% Alc./Vol. (90 Proof)",
          reason: "Alcohol content matches.",
        },
        {
          field: "netContents",
          status: "match",
          applicationValue: "750 mL",
          labelValue: "750 mL",
          reason: "Net contents match.",
        },
        {
          field: "governmentWarning",
          status: "match",
          applicationValue: null,
          labelValue: "GOVERNMENT WARNING: ...",
          reason: "Mandatory health warning present, all-caps lead-in, exact text.",
        },
      ],
    },
  },
  {
    caseId: "demo-case-mismatch-000000000001",
    application: MISMATCH_APPLICATION,
    finalState: "has_mismatches",
    severity: "red",
    report: {
      matchPercentage: 62,
      overall: "has_mismatches",
      summary:
        "Brand name and alcohol content on the label differ from the application.",
      verdicts: [
        {
          field: "brandName",
          status: "mismatch",
          applicationValue: "CHÂTEAU MARGAUX",
          labelValue: "CHATEAU MARGEAUX",
          reason:
            "Label brand 'CHATEAU MARGEAUX' differs from application 'CHÂTEAU MARGAUX' (spelling).",
        },
        {
          field: "classType",
          status: "close_match",
          applicationValue: "Red Bordeaux Wine",
          labelValue: "Bordeaux Red Wine",
          reason: "Word order differs but the designation is equivalent.",
        },
        {
          field: "alcoholContent",
          status: "mismatch",
          applicationValue: "13.5% Alc./Vol.",
          labelValue: "14.5% Alc./Vol.",
          reason: "Label states 14.5% vs application 13.5% — substantive difference.",
        },
        {
          field: "netContents",
          status: "match",
          applicationValue: "750 mL",
          labelValue: "750 mL",
          reason: "Net contents match.",
        },
        {
          field: "governmentWarning",
          status: "match",
          applicationValue: null,
          labelValue: "GOVERNMENT WARNING: ...",
          reason: "Mandatory health warning present and exact.",
        },
      ],
    },
  },
  {
    caseId: "demo-case-needsreview-00000001",
    application: NEEDS_REVIEW_APPLICATION,
    finalState: "needs_review",
    severity: "amber",
    report: {
      matchPercentage: 88,
      overall: "needs_review",
      summary:
        "Fields match, but the GOVERNMENT WARNING lead-in boldness is uncertain — needs human review.",
      verdicts: [
        {
          field: "brandName",
          status: "match",
          applicationValue: "RIVER BEND BREWING",
          labelValue: "RIVER BEND BREWING",
          reason: "Brand name matches.",
        },
        {
          field: "classType",
          status: "match",
          applicationValue: "India Pale Ale",
          labelValue: "India Pale Ale",
          reason: "Class/type matches.",
        },
        {
          field: "alcoholContent",
          status: "match",
          applicationValue: "6.8% Alc./Vol.",
          labelValue: "6.8% Alc./Vol.",
          reason: "Alcohol content matches.",
        },
        {
          field: "governmentWarning",
          status: "needs_review",
          applicationValue: null,
          labelValue: "GOVERNMENT WARNING: ...",
          reason:
            "Lead-in text is present but the model is unsure it is rendered bold (low confidence).",
        },
      ],
    },
    warning: {
      leadInDetected: true,
      boldnessConfidence: 0.3,
      uncertaintyReason:
        "Low-contrast label finish makes it unclear whether the 'GOVERNMENT WARNING:' lead-in is bold.",
      verdict: "needs_review",
    },
  },
];

/**
 * Delete the demo batch's rows in FK-safe order (children before parents) so a
 * re-run refreshes the demo cleanly. Scoped strictly to DEMO_BATCH_ID's cases.
 * Assignments and the batch row itself are removed last.
 */
async function purgeDemoBatch(db: DbClient): Promise<void> {
  const caseFilter = "case_id in (select id from cases where batch_id = $1)";
  // Children of cases first.
  await db.query(`delete from warning_evidence where ${caseFilter}`, [
    DEMO_BATCH_ID,
  ]);
  await db.query(`delete from verdicts where ${caseFilter}`, [DEMO_BATCH_ID]);
  await db.query(`delete from extracted_fields where ${caseFilter}`, [
    DEMO_BATCH_ID,
  ]);
  await db.query(`delete from case_files where ${caseFilter}`, [DEMO_BATCH_ID]);
  await db.query(`delete from dispositions where ${caseFilter}`, [
    DEMO_BATCH_ID,
  ]);
  await db.query(`delete from processing_attempts where ${caseFilter}`, [
    DEMO_BATCH_ID,
  ]);
  // Children of the batch.
  await db.query("delete from exports where batch_id = $1", [DEMO_BATCH_ID]);
  await db.query("delete from assignments where batch_id = $1", [
    DEMO_BATCH_ID,
  ]);
  await db.query("delete from cases where batch_id = $1", [DEMO_BATCH_ID]);
  await db.query("delete from batches where id = $1", [DEMO_BATCH_ID]);
}

/**
 * Seed one demo case all the way to its review-ready state through LEGAL
 * transitions (queued -> extracting -> scoring -> final), with its application
 * fields, a verdict whose payload is the spec's MatchReport, application+label
 * file manifest rows (placeholder object keys), and — for needs_review — a
 * warning_evidence row.
 */
async function seedDemoCase(db: DbClient, spec: DemoCaseSpec): Promise<void> {
  const { caseId, application, finalState, severity, report } = spec;

  // Insert at `queued` then walk the case state machine to the final state.
  await insertCase(db, {
    id: caseId,
    batchId: DEMO_BATCH_ID,
    status: "queued",
    severity,
    brand: application.brandName,
    classType: application.classType,
    applicant: application.applicantNameAddress,
  });
  await setCaseStatus(db, caseId, "extracting");
  await setCaseStatus(db, caseId, "scoring");
  await setCaseStatus(db, caseId, finalState);

  // Application fields (what intake persists; the read path & worker rely on
  // these `application.*` rows).
  await insertExtractedFields(
    db,
    caseId,
    applicationToFields(application, (key) => `demo-appfield-${caseId}-${key}`)
  );

  // Verdict row whose payload is a real MatchReport, consistent with the state.
  await insertVerdict(db, {
    id: `demo-verdict-${caseId}`,
    caseId,
    overall: report.overall,
    matchPercent: report.matchPercentage,
    payload: report,
    rulesetVersion: "demo-seed",
  });

  // Application + label file manifest rows with placeholder object keys.
  await insertCaseFile(db, {
    id: `demo-file-${caseId}-application`,
    caseId,
    kind: "application",
    objectProvider: "demo",
    objectKey: `demo/${caseId}/application.pdf`,
    contentType: "application/pdf",
  });
  await insertCaseFile(db, {
    id: `demo-file-${caseId}-label`,
    caseId,
    kind: "label",
    objectProvider: "demo",
    objectKey: `demo/${caseId}/label.png`,
    contentType: "image/png",
  });

  // Warning evidence (only for the needs_review case) so the Case Detail
  // warning panel has data.
  if (spec.warning) {
    await insertWarningEvidence(db, {
      id: `demo-warning-${caseId}`,
      caseId,
      cropObjectKey: `demo/${caseId}/warning-crop.png`,
      leadInDetected: spec.warning.leadInDetected,
      boldnessConfidence: spec.warning.boldnessConfidence,
      uncertaintyReason: spec.warning.uncertaintyReason,
      verdict: spec.warning.verdict,
    });
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the demo batch.");
  }

  const db = createPgPool();
  try {
    await runMigrations(db);

    // 1. Ensure the demo reviewer exists (seeded by `npm run seed`).
    const reviewer = await getUserByEmail(db, DEMO_REVIEWER_EMAIL);
    if (!reviewer) {
      throw new Error(
        `Demo reviewer ${DEMO_REVIEWER_EMAIL} not found. Run \`npm run seed\` first to create the demo users, then re-run \`npm run seed:demo\`.`
      );
    }

    // 2. Refresh: drop the prior demo batch so re-runs don't pile up.
    await purgeDemoBatch(db);

    // 3. Create the demo batch owned by the reviewer, then walk it to
    //    `ready_for_review` through legal batch transitions
    //    (draft -> preflighting -> ready_to_process -> processing ->
    //    ready_for_review). insertBatch defaults to `draft`.
    await insertBatch(db, {
      id: DEMO_BATCH_ID,
      name: DEMO_BATCH_NAME,
      ownerUserId: reviewer.id,
      status: "draft",
    });
    await setBatchStatus(db, DEMO_BATCH_ID, "preflighting");
    await setBatchStatus(db, DEMO_BATCH_ID, "ready_to_process");
    await setBatchStatus(db, DEMO_BATCH_ID, "processing");
    await setBatchStatus(db, DEMO_BATCH_ID, "ready_for_review");

    // 4. Assign the batch to the reviewer so getWorkQueue surfaces it for them.
    await insertAssignment(db, {
      id: `demo-assignment-${DEMO_BATCH_ID}`,
      batchId: DEMO_BATCH_ID,
      userId: reviewer.id,
    });

    // 5. Seed the demo cases.
    for (const spec of DEMO_CASES) {
      await seedDemoCase(db, spec);
    }

    // 6. Summary.
    console.log("Seeded demo batch:");
    console.log(`  batch id:   ${DEMO_BATCH_ID}`);
    console.log(`  batch name: ${DEMO_BATCH_NAME} (ready_for_review)`);
    console.log(`  owner:      ${reviewer.email} (${reviewer.id})`);
    console.log(`  cases:`);
    for (const spec of DEMO_CASES) {
      console.log(
        `    - ${spec.caseId}  state=${spec.finalState}  severity=${spec.severity}  match=${spec.report.matchPercentage}%`
      );
    }
    console.log("");
    console.log(
      `Log in as ${DEMO_REVIEWER_EMAIL} to see these in the Work Queue.`
    );
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
