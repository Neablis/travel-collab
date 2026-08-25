"use client";

import { useEffect, useMemo, useState } from "react";
import { getSession, signOut } from "next-auth/react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { initialsFor } from "@/lib/initials";

// Handoff `…dc.html:97`: the 30px round avatar sits between Tailwind's h-7
// (28px) and h-8 (32px) steps — same computed-geometry escape hatch as
// CalendarLens's CELL_MIN_HEIGHT (no token equivalent, so a style object
// rather than an arbitrary `h-[30px]` className the color wall bans).
const AVATAR_SIZE = { height: "30px", width: "30px" };

// Handoff `…dc.html:94-103, 3091-3095`: the header's avatar button, opening
// a Popover with the signed-in identity and Sign out. Self-contained — no
// trip context — so Phase 1b's scope-aware header can absorb it later
// without leaving two client boundaries in one bar (phase-8b.2 brief).
//
// SPEC.md §5, and this is not hypothetical: the design file's own version of
// this trigger (`this.once('acct', ...)`) worked around the same bug — a
// fresh trigger element every render makes Radix re-render in a loop and
// hard-locks the main thread. useMemo keeps the element reference stable
// across renders that don't change the identity it displays.
export function AccountMenu({
  name,
  email,
  onSignOut,
}: {
  name: string;
  email: string;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initials = initialsFor(name);

  const trigger = useMemo(
    () => (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Account menu"
        title={name}
        className="shrink-0 rounded-full border border-hairline bg-moss text-xs font-semibold text-slate hover:bg-moss hover:text-slate"
        // eslint-disable-next-line no-restricted-syntax -- see AVATAR_SIZE above
        style={AVATAR_SIZE}
      >
        {initials}
      </Button>
    ),
    [name, initials],
  );

  return (
    <Popover open={open} onOpenChange={setOpen} align="end" contentClassName="w-56 p-1" trigger={trigger}>
      <div className="flex flex-col gap-0.5 border-b border-hairline px-2.5 pt-2 pb-2.5">
        <span className="text-sm font-semibold text-ink">{name}</span>
        <span
          className="font-mono text-slate"
          // eslint-disable-next-line no-restricted-syntax -- 11.5px email text (handoff `…dc.html:97`) is below Tailwind's text-xs (12px) floor, same convention as UnscheduledRack/MapRail's 11.5px labels
          style={{ fontSize: "11.5px" }}
        >
          {email}
        </span>
      </div>
      <Button
        variant="ghost"
        className="mt-1 h-auto w-full justify-start rounded-md px-2.5 py-2 text-sm font-normal text-ink"
        onClick={() => onSignOut?.()}
      >
        Sign out
      </Button>
    </Popover>
  );
}

// AppHeader can't call next-auth's server-side `auth()` itself to hand this
// component its props: `src/components` is UI, and the UI/server lint wall
// (AGENTS.md invariant 6, "server logic does not leak into components") bars
// importing `@/server/*` from anywhere outside src/server and src/app/api.
// So the identity is resolved here, client-side, via next-auth/react's
// `getSession`/`signOut` — the same NextAuth instance, reached through its
// client-side door (`/api/auth/session`, `/api/auth/signout`, both already
// registered by src/app/api/auth/[...nextauth]/route.ts) rather than a
// second auth path.
export function AccountMenuFromSession() {
  const [user, setUser] = useState<{ name?: string | null; email?: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((session) => {
      if (!cancelled) setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  return (
    <AccountMenu
      name={user.name ?? user.email ?? "Account"}
      email={user.email ?? ""}
      onSignOut={() => void signOut({ callbackUrl: "/" })}
    />
  );
}
