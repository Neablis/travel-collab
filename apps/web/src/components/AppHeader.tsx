import Link from "next/link";

// Handoff `current/…dc.html:63-78`: a persistent bar on every route. Before
// this, /playbooks had no way back to the trip list at all. Deliberately a
// server component with no trip context — it must not force layout.tsx client-
// side. The prototype's "Quick add" is omitted: it needs a trip to add to, so
// it belongs on the trip surface, not here.
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hairline bg-surface px-6">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand text-surface"
        >
          ◎
        </span>
        <span className="font-display text-md font-semibold text-ink">Trip Planner</span>
      </Link>
      <nav className="flex items-center gap-1 pl-2">
        <Link href="/" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Trips
        </Link>
        <Link href="/playbooks" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Playbooks
        </Link>
      </nav>
    </header>
  );
}
