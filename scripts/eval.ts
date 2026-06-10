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

const ROOT = path.join(__dirname, "..");
const IMAGES = path.join(ROOT, "eval", "images");
const SNAPSHOTS = path.join(ROOT, "eval", "snapshots");
const LIVE = process.argv.includes("--live");

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

interface Golden {
  cases: RealCase[];
  generatedSeeds: Array<{ seed: number; defects: number }>;
}

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

async function main(): Promise<void> {
  console.log(LIVE ? "MODE: live (re-extracting, costs credits)" : "MODE: offline snapshot replay");

  for (const c of golden.cases) {
    const app = ColaApplication.parse(c.application);
    let extracted: ExtractedLabel | null;
    if (LIVE) {
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

  for (const g of golden.generatedSeeds) {
    const id = `gen_${g.seed}_${g.defects}d`;
    const gc = generateCase(g.seed, { defects: g.defects });
    const expect: Expectation = {
      overall: g.defects === 0 ? "all_match" : "has_mismatches",
      minMatch: g.defects === 0 ? 100 : 0,
      flaggedFields: gc.injectedDefects.map((d) => d.field),
    };
    let extracted: ExtractedLabel | null;
    if (LIVE) {
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

  console.log(failures === 0 ? "\nEVAL GREEN" : `\nEVAL RED: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
