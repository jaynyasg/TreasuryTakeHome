/**
 * Proof of life: one real label set (LabelExample1, OTIUM CELLARS) through
 * the real extractor and the real engine. Run: npx tsx scripts/prove.ts
 */
import fs from "node:fs";
import path from "node:path";
import { extractLabel } from "../lib/extract";
import { buildMatchReport } from "../lib/engine/score";
import { ColaApplication } from "../lib/contract";

function dataUrl(file: string): string {
  const buf = fs.readFileSync(file);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

// Transcribed from LabelExample1.pdf (TTB ID 10200001000187).
const application: ColaApplication = {
  serialNumber: "100002",
  beverageType: "wine",
  sourceOfProduct: "domestic",
  brandName: "OTIUM CELLARS",
  classType: "Pinot Gris",
  alcoholContent: "12",
  netContents: "750 MILLILITERS",
  applicantNameAddress:
    "EIGHT CHAINS NORTH, FURNACE MOUNTAIN VINEYARDS LLC, 38593 DAYMONT LN, WATERFORD VA 20197, OTIUM CELLARS",
  wineAppellation: "LOUDOUN COUNTY VIRGINIA",
  wineVintage: "2009",
};

async function main(): Promise<void> {
  const dir = path.join(__dirname, "..", "eval", "images");
  const images = ["labelexample1_p2_0.jpg", "labelexample1_p3_1.jpg"].map((f) =>
    dataUrl(path.join(dir, f))
  );
  const started = Date.now();
  const extracted = await extractLabel(images);
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
