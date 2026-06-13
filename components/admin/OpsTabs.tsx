"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Operations Console tab strip (plan "Admin IA": Health, Failed/Dead-letter,
 * Assignments, Exports, Retention, Storage Reconciliation, Settings).
 *
 * The shell's `RoleNav` only links the subset of tabs that existed before Stage
 * 8 (Operations, Assignments, Retention, Storage, Settings); the Failed and
 * Exports tabs are NEW and have no nav entry there (RoleNav lives in the shell,
 * outside this Stage's editable surface). This in-page tab strip links ALL seven
 * tabs so every Operations screen is reachable, with the current tab marked.
 */

interface Tab {
  href: string;
  label: string;
}

const TABS: Tab[] = [
  { href: "/admin", label: "Health" },
  { href: "/admin/failed", label: "Failed jobs" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/exports", label: "Exports" },
  { href: "/admin/retention", label: "Retention" },
  { href: "/admin/storage", label: "Storage" },
  { href: "/admin/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function OpsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Operations console" className="overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b border-line">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex min-h-[40px] items-center rounded-t-lg px-3 text-[12.5px] font-medium transition " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
                  (active
                    ? "border-b-2 border-ink text-ink"
                    : "text-muted hover:text-ink")
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
