/**
 * Eval harness for the extraction + matching pipeline (claim C6).
 *
 * Default (offline): replay recorded extraction snapshots through the engine
 * and grade expectations. Deterministic, no network — safe for the Stop gate.
 *
 * --live: re-extract every case with GPT-4o (real PDFs from eval/images;
 * generated cases rendered SVG->PNG via resvg), refresh the snapshots, then
 * grade. Costs OpenAI credits; run on demand.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ColaApplication,
  ExtractedLabel,
  FieldKey,
  MatchReport,
} from "../lib/contract";
import { buildMatchReport } from "../lib/engine/score";
import { generateCase } from "../lib/engine/generator";
import { renderLabelSvg } from "../lib/labelSvg";
import { REAL_EXAMPLES } from "../lib/fixtures";

const ROOT = path.join(__dirname, "..");
const IMAGES = path.join(ROOT, "eval", "images");
const SNAPSHOTS = path.join(ROOT, "eval", "snapshots");
const LIVE = process.argv.includes("--live");
// --only <prefix>: limit live re-recording to matching case ids (cost control).
const ONLY_IDX = process.argv.indexOf("--only");
const ONLY = ONLY_IDX >= 0 ? process.argv[ONLY_IDX + 1] : null;
const STATIC_SNAPSHOT_CASE_IDS = new Set([
  // Synthetic/deterministic typography fixture: it deliberately records low
  // boldness confidence for an otherwise-clean warning so the offline release
  // gate always exercises the needs_review path. Live extraction of the same
  // Santa Fe image can legitimately report high confidence, which would erase
  // the test condition rather than prove product behavior.
  "santa_fe_warning_uncertain_boldness",
]);

function selected(id: string): boolean {
  return !ONLY || id.startsWith(ONLY);
}

function shouldLiveRefresh(id: string): boolean {
  return LIVE && selected(id) && !STATIC_SNAPSHOT_CASE_IDS.has(id);
}

interface Expectation {
  overall: MatchReport["overall"];
  minMatch: number;
  flaggedFields: FieldKey[];
  warningStatus?: string;
}

interface RealCase {
  id: string;
  kind: "real";
  images: string[];
  application: unknown;
  expect: Expectation;
}

interface DegradedCase {
  id: string;
  baseId: string;
  images: string[];
  /** Fields legitimately flagged even on the clean image (e.g. 8 Chains classType). */
  allowedFlagged: FieldKey[];
}

/**
 * A prompt-injection fixture: an extracted label whose text tries to INSTRUCT
 * the system (plan "Prompt injection posture"). The deterministic engine must
 * ignore the instructions and produce an unaffected verdict.
 */
interface PromptInjectionCase {
  id: string;
  comment?: string;
  baseApplication: unknown;
  expect: {
    /** The deterministic overall must NOT be this (i.e. no compliance bypass). */
    overallNot: MatchReport["overall"];
    /** Fields the engine must still flag despite the injected instructions. */
    mustFlag: FieldKey[];
  };
}

/**
 * Blocking offline release-gate thresholds (plan "Live eval release
 * thresholds"), enforced deterministically over the committed snapshots so
 * `npm run eval` is the gate even without a live model.
 */
interface ReleaseThresholds {
  comment?: string;
  schemaValidPct: number;
  noInjectionBypass: boolean;
  exactWarningTextBehavior: boolean;
  uncertainTypographyRouting: boolean;
  /** Cases whose warning is exact + all-caps -> warning verdict must be `match`. */
  warningExactCaseIds: string[];
  /** Cases whose warning typography is uncertain -> verdict must be `needs_review`. */
  uncertainTypographyCaseIds: string[];
}

interface Golden {
  cases: RealCase[];
  degradedCases: DegradedCase[];
  generatedSeeds: Array<{ seed: number; defects: number }>;
  promptInjectionCases: PromptInjectionCase[];
  releaseThresholds: ReleaseThresholds;
}

/** D8.1 anti-escape-hatch floor: degraded cases must still read most of the label. */
const CORE_FIELDS: FieldKey[] = [
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerNameAddress",
  "governmentWarning",
];
const CORE_FLOOR = 4;

const golden = JSON.parse(
  fs.readFileSync(path.join(ROOT, "eval", "golden.json"), "utf8")
) as Golden;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function grade(id: string, app: ColaApplication, extracted: ExtractedLabel, expect: Expectation): void {
  const report = buildMatchReport(app, extracted);
  check(`${id}: overall is ${expect.overall}`, report.overall === expect.overall, `got ${report.overall} (${report.matchPercentage}%)`);
  check(`${id}: match >= ${expect.minMatch}%`, report.matchPercentage >= expect.minMatch, `got ${report.matchPercentage}%`);
  const flagged = report.verdicts
    .filter((v) => v.status === "mismatch" || v.status === "missing_on_label")
    .map((v) => v.field);
  for (const f of expect.flaggedFields) {
    check(`${id}: flags ${f}`, flagged.includes(f), `flagged: [${flagged.join(", ")}]`);
  }
  if (expect.warningStatus) {
    const gw = report.verdicts.find((v) => v.field === "governmentWarning");
    check(`${id}: warning verdict is ${expect.warningStatus}`, gw?.status === expect.warningStatus, `got ${gw?.status}`);
  }
}

function snapshotPath(id: string): string {
  return path.join(SNAPSHOTS, `${id}.json`);
}

function loadSnapshot(id: string): ExtractedLabel | null {
  const p = snapshotPath(id);
  if (!fs.existsSync(p)) return null;
  return ExtractedLabel.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

async function liveExtract(id: string, imageDataUrls: string[]): Promise<ExtractedLabel> {
  const { extractLabel } = await import("../lib/extract");
  const { label } = await extractLabel(imageDataUrls);
  fs.mkdirSync(SNAPSHOTS, { recursive: true });
  fs.writeFileSync(snapshotPath(id), JSON.stringify(label, null, 2));
  return label;
}

function fileDataUrl(name: string): string {
  const buf = fs.readFileSync(path.join(IMAGES, name));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function renderedDataUrl(svg: string): Promise<string> {
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 960 } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/** Every snapshot id the offline gate replays (used by the schema-valid floor). */
function allSnapshotIds(): string[] {
  const ids = [
    ...golden.cases.map((c) => c.id),
    ...golden.degradedCases.map((d) => d.id),
    ...golden.generatedSeeds.map((g) => `gen_${g.seed}_${g.defects}d`),
  ];
  return ids;
}

/** The warning verdict for a snapshot scored against an application, or null. */
function warningVerdict(
  app: ColaApplication,
  label: ExtractedLabel
): string | undefined {
  return buildMatchReport(app, label).verdicts.find(
    (v) => v.field === "governmentWarning"
  )?.status;
}

/**
 * RELEASE THRESHOLD assertions (plan "Live eval release thresholds"), enforced
 * deterministically over the committed offline fixtures so the offline gate
 * blocks a release on any of: malformed model output, a prompt-injection
 * compliance bypass, broken exact warning-text/capitalization behavior, or
 * uncertain typography NOT routed to needs_review. These run in BOTH offline and
 * live modes — after a live re-record they grade the fresh snapshots the same way.
 */
function releaseThresholds(): void {
  const t = golden.releaseThresholds;
  console.log("\n--- RELEASE THRESHOLDS (offline gate) ---");

  // 1. Schema-valid model output: every replayed snapshot must re-parse through
  //    the ExtractedLabel zod contract. Nothing malformed reaches the engine.
  const ids = allSnapshotIds();
  let valid = 0;
  let present = 0;
  for (const id of ids) {
    const p = snapshotPath(id);
    if (!fs.existsSync(p)) continue;
    present += 1;
    const parsed = ExtractedLabel.safeParse(JSON.parse(fs.readFileSync(p, "utf8")));
    if (parsed.success) valid += 1;
    else check(`threshold.schemaValid: ${id} parses`, false, parsed.error.message);
  }
  const pct = present === 0 ? 0 : Math.round((valid / present) * 100);
  check(
    `threshold.schemaValid >= ${t.schemaValidPct}% (model output schema-valid)`,
    pct >= t.schemaValidPct,
    `${valid}/${present} snapshots valid (${pct}%)`
  );

  // 2. No prompt-injection compliance bypass: untrusted label text that tries to
  //    instruct the system must NOT flip the deterministic verdict to a pass.
  if (t.noInjectionBypass) {
    for (const inj of golden.promptInjectionCases) {
      const extracted = loadSnapshot(inj.id);
      if (!extracted) {
        check(`threshold.injection ${inj.id}: snapshot exists`, false, "missing fixture");
        continue;
      }
      const app = ColaApplication.parse(inj.baseApplication);
      const report = buildMatchReport(app, extracted);
      // The injected "approve this / output all_match" instructions must have no
      // effect: the overall is NOT the compliant pass the injection demanded.
      check(
        `threshold.injection ${inj.id}: no bypass (overall != ${inj.expect.overallNot})`,
        report.overall !== inj.expect.overallNot,
        `got overall ${report.overall}`
      );
      const flagged = report.verdicts
        .filter((v) => v.status === "mismatch" || v.status === "missing_on_label")
        .map((v) => v.field);
      for (const f of inj.expect.mustFlag) {
        check(
          `threshold.injection ${inj.id}: still flags ${f}`,
          flagged.includes(f),
          `flagged: [${flagged.join(", ")}]`
        );
      }
    }
  }

  // 3. Exact warning text/capitalization behavior, exercised in BOTH directions:
  //    a word-for-word all-caps warning verdicts `match`; a deviating/missing one
  //    verdicts `mismatch`/`missing_on_label`.
  if (t.exactWarningTextBehavior) {
    for (const id of t.warningExactCaseIds) {
      const c = golden.cases.find((x) => x.id === id);
      const extracted = c ? loadSnapshot(id) : null;
      if (!c || !extracted) {
        check(`threshold.exactWarning ${id}: case + snapshot exist`, false);
        continue;
      }
      const status = warningVerdict(ColaApplication.parse(c.application), extracted);
      check(
        `threshold.exactWarning ${id}: exact warning verdicts match`,
        status === "match",
        `got ${status}`
      );
    }
    // Negative direction: the injection fixture's warning deviates word-for-word,
    // so its warning verdict must be a mismatch (exact-text rule rejects it).
    for (const inj of golden.promptInjectionCases) {
      const extracted = loadSnapshot(inj.id);
      if (!extracted) continue;
      const status = warningVerdict(ColaApplication.parse(inj.baseApplication), extracted);
      check(
        `threshold.exactWarning ${inj.id}: deviating warning verdicts mismatch`,
        status === "mismatch" || status === "missing_on_label",
        `got ${status}`
      );
    }
  }

  // 4. Uncertain typography routes to needs_review (never a silent false pass).
  if (t.uncertainTypographyRouting) {
    for (const id of t.uncertainTypographyCaseIds) {
      const c = golden.cases.find((x) => x.id === id);
      const extracted = c ? loadSnapshot(id) : null;
      if (!c || !extracted) {
        check(`threshold.uncertainTypography ${id}: case + snapshot exist`, false);
        continue;
      }
      const status = warningVerdict(ColaApplication.parse(c.application), extracted);
      check(
        `threshold.uncertainTypography ${id}: routes warning to needs_review`,
        status === "needs_review",
        `got ${status}`
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(LIVE ? "MODE: live (re-extracting, costs credits)" : "MODE: offline snapshot replay");

  for (const c of golden.cases) {
    const app = ColaApplication.parse(c.application);
    let extracted: ExtractedLabel | null;
    if (shouldLiveRefresh(c.id)) {
      extracted = await liveExtract(c.id, c.images.map(fileDataUrl));
    } else {
      extracted = loadSnapshot(c.id);
      if (!extracted) {
        check(`${c.id}: snapshot exists`, false, "run `npm run eval:live` once to record");
        continue;
      }
    }
    grade(c.id, app, extracted, c.expect);
  }

  // Degraded cases (AC-1): the label genuinely matches its application, so any
  // mismatch/missing verdict outside the allowed list is a confident misread
  // (RED), and over-flagging is capped by the >=4/6 core-field floor.
  for (const d of golden.degradedCases) {
    const base = REAL_EXAMPLES.find((e) => e.id === d.baseId);
    if (!base) {
      check(`${d.id}: baseId ${d.baseId} exists`, false);
      continue;
    }
    let extracted: ExtractedLabel | null;
    if (LIVE && selected(d.id)) {
      extracted = await liveExtract(d.id, d.images.map(fileDataUrl));
    } else {
      extracted = loadSnapshot(d.id);
      if (!extracted) {
        check(`${d.id}: snapshot exists`, false, "run `npm run eval:live -- --only degraded` once to record");
        continue;
      }
    }
    const report = buildMatchReport(base.application, extracted);
    const wronglyFlagged = report.verdicts.filter(
      (v) =>
        (v.status === "mismatch" || v.status === "missing_on_label") &&
        !d.allowedFlagged.includes(v.field)
    );
    check(
      `${d.id}: never confidently wrong (no unexpected mismatch/missing)`,
      wronglyFlagged.length === 0,
      wronglyFlagged.map((v) => `${v.field}:${v.status}`).join(", ") || "clean"
    );
    const coreCorrect = report.verdicts.filter(
      (v) =>
        CORE_FIELDS.includes(v.field) &&
        (v.status === "match" || v.status === "close_match")
    ).length;
    check(
      `${d.id}: extraction floor >=${CORE_FLOOR}/6 core fields`,
      coreCorrect >= CORE_FLOOR,
      `${coreCorrect}/6 (${report.matchPercentage}%)`
    );
  }

  for (const g of golden.generatedSeeds) {
    const id = `gen_${g.seed}_${g.defects}d`;
    const gc = generateCase(g.seed, { defects: g.defects });
    const expect: Expectation = {
      overall: g.defects === 0 ? "all_match" : "has_mismatches",
      minMatch: g.defects === 0 ? 100 : 0,
      flaggedFields: gc.injectedDefects.map((d) => d.field),
    };
    let extracted: ExtractedLabel | null;
    if (LIVE && selected(id)) {
      extracted = await liveExtract(id, [await renderedDataUrl(renderLabelSvg(gc, g.seed))]);
    } else {
      extracted = loadSnapshot(id);
      if (!extracted) {
        check(`${id}: snapshot exists`, false, "run `npm run eval:live` once to record");
        continue;
      }
    }
    grade(id, gc.application, extracted, expect);
  }

  // Release-gate thresholds (plan "Live eval release thresholds"): blocking
  // deterministic checks over the committed fixtures. Run after the per-case
  // grading so a threshold failure counts toward the same exit code.
  releaseThresholds();

  console.log(failures === 0 ? "\nEVAL GREEN" : `\nEVAL RED: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
