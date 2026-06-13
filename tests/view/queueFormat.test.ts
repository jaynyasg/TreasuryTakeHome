import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  formatAbsoluteTime,
  joinIdentityParts,
  shortOwner,
} from "@/components/queue/format";

const NOW = Date.parse("2026-06-13T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("returns 'just now' for sub-minute deltas and small clock skew", () => {
    expect(formatRelativeTime("2026-06-13T11:59:30.000Z", NOW)).toBe("just now");
    // Future timestamp (skew) collapses to 'just now', never a negative.
    expect(formatRelativeTime("2026-06-13T12:05:00.000Z", NOW)).toBe("just now");
  });

  it("renders minutes, hours, and days", () => {
    expect(formatRelativeTime("2026-06-13T11:55:00.000Z", NOW)).toBe("5m ago");
    expect(formatRelativeTime("2026-06-13T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(formatRelativeTime("2026-06-11T12:00:00.000Z", NOW)).toBe("2d ago");
  });

  it("falls back to an absolute short date past a week", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00.000Z", NOW)).toBe("Jun 1");
  });

  it("returns an em-dash for an unparseable timestamp", () => {
    expect(formatRelativeTime("", NOW)).toBe("—");
    expect(formatRelativeTime("not-a-date", NOW)).toBe("—");
  });
});

describe("formatAbsoluteTime", () => {
  it("returns '—' for bad input and a UTC string otherwise", () => {
    expect(formatAbsoluteTime("nope")).toBe("—");
    const out = formatAbsoluteTime("2026-06-13T12:00:00.000Z");
    expect(out).toContain("2026");
    expect(out).toContain("UTC");
  });
});

describe("joinIdentityParts", () => {
  it("joins present parts with a middle dot and drops empties/nulls", () => {
    expect(joinIdentityParts(["Wine", "Acme Co"])).toBe("Wine · Acme Co");
    expect(joinIdentityParts([null, "Acme Co"])).toBe("Acme Co");
    expect(joinIdentityParts(["  ", null])).toBe("");
    expect(joinIdentityParts(["Wine", "  ", "Acme"])).toBe("Wine · Acme");
  });
});

describe("shortOwner", () => {
  it("labels unassigned and truncates long ids", () => {
    expect(shortOwner(null)).toBe("Unassigned");
    expect(shortOwner("rev-007")).toBe("rev-007");
    expect(shortOwner("reviewer-1234567890")).toBe("reviewer…");
  });
});
