/**
 * Live API smoke against a running dev server: happy path + error states.
 * Run: npx tsx scripts/smoke-api.ts [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import { VerifyResponse, ApiError } from "../lib/contract";
import { OTIUM_APPLICATION as application } from "../lib/fixtures";

const BASE = process.argv[2] ?? "http://localhost:3000";

function img(name: string): string {
  const buf = fs.readFileSync(path.join(__dirname, "..", "eval", "images", name));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/**
 * Success responses stream NDJSON (stage lines + one terminal object);
 * request-shape errors come back as plain JSON 400s. Parse both.
 */
async function post(body: unknown): Promise<{ status: number; json: unknown; stages: string[] }> {
  const res = await fetch(`${BASE}/api/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const stages: string[] = [];
  let terminal: unknown = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && "stage" in obj) {
      stages.push(String((obj as { stage: unknown }).stage));
    } else {
      terminal = obj;
    }
  }
  return { status: res.status, json: terminal, stages };
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  // Happy path: real OTIUM label set.
  const happy = await post({
    application,
    imageDataUrls: [img("labelexample1_p2_0.jpg"), img("labelexample1_p3_1.jpg")],
  });
  const parsed = VerifyResponse.safeParse(happy.json);
  check("happy path returns 200 + contract-valid body", happy.status === 200 && parsed.success);
  check(
    "stream emits real stage events in order",
    happy.stages.join(",") === "extracting,matching",
    `stages: [${happy.stages.join(", ")}]`
  );
  if (parsed.success) {
    check(
      "OTIUM sample scores 100 with all_match",
      parsed.data.report.matchPercentage === 100 && parsed.data.report.overall === "all_match",
      `${parsed.data.report.matchPercentage}% / ${parsed.data.report.overall}`
    );
    check("latency within 10s budget (5s target)", parsed.data.elapsedMs < 10000, `${parsed.data.elapsedMs}ms`);
  }

  // Error states must be clean ApiError shapes, never crashes.
  const badJson = await post("{not json");
  check("malformed JSON -> 400 ApiError", badJson.status === 400 && ApiError.safeParse(badJson.json).success);

  const badSchema = await post({ application: { brandName: "X" }, imageDataUrls: [] });
  check("schema violation -> 400 ApiError", badSchema.status === 400 && ApiError.safeParse(badSchema.json).success);

  const notImage = await post({ application, imageDataUrls: ["data:text/plain;base64,aGk="] });
  check("non-image data URL -> 400 ApiError", notImage.status === 400 && ApiError.safeParse(notImage.json).success);

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
