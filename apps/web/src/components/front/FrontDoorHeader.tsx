import Link from "next/link";

// The front door's own chrome. `dc.html:1471-1483` gives the landing header
// wordmark + two CTAs; `:1587-1592` gives the auth header the same wordmark
// alone, linking home. One component, one optional actions slot, so neither
// LandingScreen nor AuthScreen has to modify this file.
export function FrontDoorHeader({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3 px-7 py-4">
      <Link href="/welcome" className="flex items-center gap-2.5 no-underline">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand text-surface"
        >
          ◎
        </span>
        <span className="font-display text-md font-semibold text-ink">Caesura</span>
      </Link>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
