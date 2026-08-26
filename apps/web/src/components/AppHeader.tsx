import Link from "next/link";
import { HeaderSessionChrome } from "@/components/AccountMenu";
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
      {/* Nav + account together, and only when signed in — see
          HeaderSessionChrome. A signed-out visitor used to be shown "Trips"
          and "Playbooks", links into pages they cannot open (Mitchell,
          preview feedback on PR #55). The logo above stays either way. */}
      <HeaderSessionChrome demoResetEnabled={demoResetEnabled} />
    </header>
  );
}
