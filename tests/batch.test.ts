import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/engine/batch";

describe("batch fan-out (C5)", () => {
  it("returns one result per item, in order", async () => {
    const results = await runBatch([1, 2, 3], async (n) => n * 10, { concurrency: 2 });
    expect(results).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it("isolates failures — one bad item doesn't sink the batch", async () => {
    const results = await runBatch(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      },
      { concurrency: 3 }
    );
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1]).toEqual({ ok: false, error: "boom" });
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("respects the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBatch(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
      { concurrency: 3 }
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});
