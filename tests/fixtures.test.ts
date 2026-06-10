import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ColaApplication } from "@/lib/contract";
import {
  EIGHT_CHAINS_APPLICATION,
  OTIUM_APPLICATION,
  REAL_EXAMPLES,
  SANTA_FE_APPLICATION,
} from "@/lib/fixtures";

interface GoldenFile {
  cases: Array<{ id: string; application: unknown }>;
}

const golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "eval", "golden.json"), "utf8")
) as GoldenFile;

function goldenApp(id: string): unknown {
  const c = golden.cases.find((x) => x.id === id);
  expect(c, `golden case ${id}`).toBeDefined();
  return c!.application;
}

/**
 * lib/fixtures.ts is the single source of truth for the real COLA samples.
 * golden.json must stay byte-equivalent — drift means the demo and the eval
 * disagree about ground truth.
 */
describe("real-sample fixtures stay in sync (T12)", () => {
  it("all fixtures are schema-valid", () => {
    for (const app of [OTIUM_APPLICATION, SANTA_FE_APPLICATION, EIGHT_CHAINS_APPLICATION]) {
      expect(() => ColaApplication.parse(app)).not.toThrow();
    }
  });

  it("golden.json otium case matches the fixture", () => {
    expect(goldenApp("otium_pinot_gris")).toEqual(OTIUM_APPLICATION);
  });

  it("golden.json santa fe case matches the fixture", () => {
    expect(goldenApp("santa_fe_straight_malt")).toEqual(SANTA_FE_APPLICATION);
  });

  it("golden.json eight chains case matches the fixture", () => {
    expect(goldenApp("eight_chains_reserve_red")).toEqual(EIGHT_CHAINS_APPLICATION);
  });

  it("every real example's images exist on disk", () => {
    for (const ex of REAL_EXAMPLES) {
      for (const img of ex.images) {
        expect(
          fs.existsSync(path.join(__dirname, "..", "eval", "images", img)),
          `${ex.id}: ${img}`
        ).toBe(true);
      }
    }
  });
});
