/**
 * Worker-safe "core" barrel: one import surface for code that may run outside
 * Next.js/React (e.g. a background batch worker).
 *
 * Everything re-exported here MUST be pure and free of `next`, `react`,
 * `react-dom`, `openai`, or any `app/` imports — enforced by
 * tests/corePurity.test.ts. Do not add framework-coupled re-exports.
 */

// State machines (this module).
export * from "./state/transition";
export * from "./state/batch";
export * from "./state/case";

// Typed contract (zod schemas + inferred types) — pure, no framework imports.
export * from "../contract";

// Pure matching/generation engine — pure functions, no I/O, no LLM SDK.
export * from "../engine/normalize";
export * from "../engine/score";
export * from "../engine/warning";
export * from "../engine/batch";
export * from "../engine/generator";
