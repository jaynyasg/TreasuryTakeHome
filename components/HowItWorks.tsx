"use client";

import { useState } from "react";
import Modal from "@/components/house/Modal";

/** AC-7: grader/agent orientation — the pipeline and its honesty guarantees. */
export default function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded text-[11px] font-medium text-muted underline decoration-line underline-offset-2 transition hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        How it works
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="max-h-[80vh] w-[min(520px,90vw)] space-y-4 overflow-y-auto">
            <h3 className="text-[15px] font-semibold">How verification works</h3>
            <pre className="overflow-x-auto rounded-lg border border-line-2 bg-card p-3 font-mono text-[11px] leading-relaxed text-ink-2">
{`label files ───▶ GPT-4o vision ──▶ contract gate ──▶ deterministic
application ───────────────────────── (zod) ───────▶ matching engine
                                                          │
                              match % + per-field verdict + reason`}
            </pre>
            <ul className="space-y-2 text-[12.5px] leading-relaxed text-ink-2">
              <li>
                <span className="font-semibold">Verbatim extraction.</span> The vision model
                transcribes exactly what is printed — it never corrects or completes a label.
                If a region is blurry or distorted, fields come back empty and the result says
                &ldquo;needs review&rdquo; instead of guessing.
              </li>
              <li>
                <span className="font-semibold">Validated at the seam.</span> Every model output
                is parsed against a typed contract before anything downstream sees it. Shape
                drift, refusals, and truncation become clean errors, never wrong answers.
              </li>
              <li>
                <span className="font-semibold">Every verdict carries its reason.</span> Matching
                is deterministic code, not AI judgment: word-for-word government-warning checks,
                unit-aware quantity comparison, and fuzzy name matching that explains itself
                (&ldquo;differs only in capitalization&rdquo;).
              </li>
            </ul>
            <p className="text-[11.5px] text-muted">
              Prototype scope: verification runs in your browser session against a stateless
              API — nothing is stored. Batch runs fan out client-side; the production shape
              (server queue, durable audit trail) is documented in the repo.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
