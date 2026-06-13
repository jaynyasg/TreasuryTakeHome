"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth/authorize";

/**
 * Role-aware primary navigation for the reviewer/admin shell (Stage 7 / T7).
 *
 * Reviewers see: Work Queue (default), Intake, Case Search, Exports,
 * Help/Runbooks. Admins additionally see Operations, Assignments, Retention,
 * Storage, and Settings. Active state is derived from the current path
 * (`usePathname`). Routes that Wave 2 / Stage 8 fill are linked as stubs.
 *
 * This is a list/landmark-first nav (rendered inside the shell's `<nav>`), not a
 * decorative sidebar — honoring the Anti-Generic UI Constraints.
 */

interface NavItem {
  href: string;
  label: string;
}

const REVIEWER_ITEMS: NavItem[] = [
  { href: "/reviewer/queue", label: "Work Queue" },
  { href: "/reviewer/intake", label: "Intake" },
  { href: "/reviewer/search", label: "Case Search" },
  { href: "/reviewer/exports", label: "Exports" },
  { href: "/reviewer/help", label: "Help & Runbooks" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Operations" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/retention", label: "Retention" },
  { href: "/admin/storage", label: "Storage" },
  { href: "/admin/settings", label: "Settings" },
];

/** True when `pathname` is `href` or a descendant of it (active section). */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // /admin is exact-only so it doesn't claim /admin/assignments etc.
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(`${href}/`);
}

function NavList({
  heading,
  items,
  pathname,
}: {
  heading: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div>
      <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-2">
        {heading}
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex min-h-[44px] items-center rounded-lg px-2.5 text-[13px] font-medium transition " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
                  (active
                    ? "bg-ink text-white"
                    : "text-ink-2 hover:bg-surface hover:text-ink")
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function RoleNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-4">
      <NavList heading="Review" items={REVIEWER_ITEMS} pathname={pathname} />
      {role === "admin" && (
        <NavList heading="Admin" items={ADMIN_ITEMS} pathname={pathname} />
      )}
    </div>
  );
}
