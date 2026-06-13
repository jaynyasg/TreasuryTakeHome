import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard test for the worker-safe core boundary (E7): nothing under lib/core/
 * may statically import a framework or LLM SDK, or reach into the app/ tree.
 * The core must stay runnable in a plain Node worker with no Next.js/React.
 */
const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "core");

/** Modules a worker-safe module must never statically import. */
const FORBIDDEN_MODULES = ["next", "react", "react-dom", "openai"];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Match the module specifier of any static import / export-from / require / dynamic import. */
const IMPORT_RE =
  /(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

function importSpecifiers(source: string): Array<{ spec: string; line: number }> {
  const found: Array<{ spec: string; line: number }> = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const line = source.slice(0, m.index).split("\n").length;
    found.push({ spec, line });
  }
  return found;
}

function isForbidden(spec: string): boolean {
  // bare module or subpath of a forbidden package, e.g. "react" / "react/jsx-runtime"
  if (FORBIDDEN_MODULES.some((mod) => spec === mod || spec.startsWith(`${mod}/`))) {
    return true;
  }
  // any import (relative or aliased) that reaches into the app/ tree
  if (/(^|\/)app\//.test(spec)) return true;
  return false;
}

describe("core boundary stays worker-safe (E7)", () => {
  it("imports at least one core file (sanity: the directory was found)", () => {
    expect(collectTsFiles(CORE_DIR).length).toBeGreaterThan(0);
  });

  it("contains no forbidden static imports under lib/core/", () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(CORE_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const { spec, line } of importSpecifiers(source)) {
        if (isForbidden(spec)) {
          violations.push(`${relative(CORE_DIR, file)}:${line} imports "${spec}"`);
        }
      }
    }
    expect(violations, `forbidden imports found:\n${violations.join("\n")}`).toEqual([]);
  });
});
