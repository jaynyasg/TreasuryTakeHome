import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts", "components/**/*.test.ts"],
    // PGlite (in-process WASM Postgres) cold-starts a fresh instance per DB
    // test. Under Vitest's parallel workers many instances initialize at once,
    // so a fresh PGlite boot can exceed the 10s default. Raise the hook/test
    // timeouts so the offline DB suite stays reliable without serializing it.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
