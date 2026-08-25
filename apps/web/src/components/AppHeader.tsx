import Link from "next/link";
import { AccountMenuFromSession } from "@/components/AccountMenu";
import { isDemoDataResetEnabled } from "@/lib/demoDataReset";

// Handoff `current/…dc.html:63-78`: a persistent bar on every route. Before
// this, /playbooks had no way back to the trip list at all. Deliberately a
// server component with no trip context — it must not force layout.tsx client-
// side. The prototype's "Quick add" is omitted: it needs a trip to add to, so
// it belongs on the trip surface, not here.
//
// The account avatar (task 8b.2) is `AccountMenuFromSession`, the one client
// island this renders — it resolves its own identity client-side rather than
// AppHeader calling `auth()`, because `auth()` lives in src/server and this
// file is UI (see AccountMenu.tsx's comment for why that boundary holds).
//
// The preview-only "Reset to demo data" item is different: `demoResetEnabled`
// is a plain env-var read (isDemoDataResetEnabled(), src/lib/demoDataReset.ts
// — not `@/server/*`, so it doesn't cross the lint wall this file is bound
// by), computed here and passed down as a prop. This is the same rule
// src/server/flags.ts documents for flag values: they reach the UI as props
// from a server component, never by a client component importing server
// code.
export function AppHeader() {
  const demoResetEnabled = isDemoDataResetEnabled();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hairline bg-surface px-6">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand text-surface"
        >
          ◎
        </span>
        <span className="font-display text-md font-semibold text-ink">Caesura</span>
      </Link>
      <nav className="flex items-center gap-1 pl-2">
        <Link href="/" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Trips
        </Link>
        <Link href="/playbooks" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Playbooks
        </Link>
      </nav>
      <div className="ml-auto flex items-center">
        <AccountMenuFromSession demoResetEnabled={demoResetEnabled} />
      </div>
    </header>
  );
}
