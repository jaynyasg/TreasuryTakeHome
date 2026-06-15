"use client";

import { useState } from "react";
import VerifyView from "@/components/VerifyView";
import GeneratorView from "@/components/GeneratorView";
import HowItWorks from "@/components/HowItWorks";

type Tab = "verify" | "generate";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "verify", label: "Verify a label", hint: "Check label files against a COLA application" },
  { id: "generate", label: "Generate test cases", hint: "Mock applications + labels, single or batch" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("verify");

  return (
    <div className="min-h-screen">
      <header className="relative select-none overflow-hidden border-b border-line bg-card/80 backdrop-blur-[2px]">
        <div aria-hidden className="dot-grid absolute inset-0" />
        <div className="relative mx-auto max-w-6xl px-5 pb-5 pt-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            TTB · Label Compliance Prototype
          </div>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Label Verify
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            Checks what&apos;s printed on an alcohol beverage label against its COLA
            application — every field, with a reason for every result.
          </p>
          <nav className="mt-5 flex gap-1.5" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.hint}
                onClick={() => setTab(t.id)}
                className={
                  "rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition active:scale-95 " +
                  (tab === t.id
                    ? "bg-ink text-white shadow-card"
                    : "border border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface")
                }
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {tab === "verify" ? <VerifyView /> : <GeneratorView />}
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-8 text-[11px] text-muted-2">
        <span>
          Prototype — no data is stored. Verification is advisory; final determinations rest
          with the reviewing agent.
        </span>
        <HowItWorks />
      </footer>
    </div>
  );
}
