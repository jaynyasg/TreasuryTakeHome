/**
 * Proof of life: one real label set (LabelExample1, OTIUM CELLARS) through
 * the real extractor and the real engine. Run: npx tsx scripts/prove.ts
 */
import fs from "node:fs";
import path from "node:path";
import { extractLabel } from "../lib/extract";
import { buildMatchReport } from "../lib/engine/score";
import { OTIUM_APPLICATION as application } from "../lib/fixtures";

function dataUrl(file: string): string {
  const buf = fs.readFileSync(file);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function main(): Promise<void> {
  const dir = path.join(__dirname, "..", "eval", "images");
  const images = ["labelexample1_p2_0.jpg", "labelexample1_p3_1.jpg"].map((f) =>
    dataUrl(path.join(dir, f))
  );
  const started = Date.now();
  const { label: extracted } = await extractLabel(images);
  const extractMs = Date.now() - started;
  console.log("--- EXTRACTED (in", extractMs, "ms) ---");
  console.log(JSON.stringify(extracted, null, 2));
  const report = buildMatchReport(application, extracted);
  console.log("--- REPORT ---");
  console.log(`Match: ${report.matchPercentage}%  Overall: ${report.overall}`);
  for (const v of report.verdicts) {
    console.log(`  [${v.status}] ${v.field}: ${v.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
