"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSession, signOut } from "next-auth/react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { initialsFor } from "@/lib/initials";
import { resetDemoData } from "@/lib/apiClient";

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
  demoResetEnabled = false,
  onResetDemoData,
}: {
  name: string;
  email: string;
  onSignOut?: () => void;
  // Preview-only "Reset to demo data" item (see AppHeader.tsx /
  // src/lib/demoDataReset.ts) — deliberate deviation from the design's
  // "Your account" + "Sign out" dropdown (task 8b.2 omitted a third item
  // rather than ship one that did nothing; this one is real and never
  // renders outside preview). `undefined` when `demoResetEnabled` is false,
  // same as `onSignOut` — nothing to call when the item doesn't exist.
  demoResetEnabled?: boolean;
  onResetDemoData?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const initials = initialsFor(name);

  // Discards the caller's trips (via DeleteTrip — recoverable server-side,
  // but not from this dialog), so a single click must not do it — same
  // confirm-before-destructive shape as page.tsx's "Delete trip" Dialog.
  async function handleConfirmReset() {
    if (!onResetDemoData) return;
    setResetBusy(true);
    setResetError(null);
    try {
      await onResetDemoData();
      setResetConfirmOpen(false);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

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
    <>
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
        {demoResetEnabled && (
          <Button
            variant="ghost"
            className="mt-1 h-auto w-full justify-start rounded-md px-2.5 py-2 text-sm font-normal text-ink"
            onClick={() => {
              // Close the popover behind the dialog and drop any error from a
              // prior attempt — otherwise a stale failure message is already
              // showing the moment this dialog reopens.
              setOpen(false);
              setResetError(null);
              setResetConfirmOpen(true);
            }}
          >
            Reset to demo data
          </Button>
        )}
      </Popover>
      {demoResetEnabled && (
        <Dialog
          open={resetConfirmOpen}
          // Radix fires this for Escape, an overlay click, and the built-in
          // close (X) button alike — mid-flight, losing this dialog is
          // exactly the "dangerous" case from Mitchell's report: no way to
          // tell whether the reset completed, ran, or did nothing.
          onOpenChange={(next) => {
            if (resetBusy) return;
            setResetConfirmOpen(next);
          }}
          title="Reset to demo data"
        >
          <Text variant="secondary">
            This deletes all of your trips and replaces them with the Japan demo trip. This can&apos;t be undone
            from here.
          </Text>
          {resetBusy && (
            <Text role="status" variant="secondary" className="mt-2">
              Replacing your trips with the demo data. This takes a few seconds — keep this open.
            </Text>
          )}
          {resetError && (
            <Text role="alert" variant="secondary" className="text-danger-ink">
              {resetError}
            </Text>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={resetBusy} onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={resetBusy} onClick={() => void handleConfirmReset()}>
              {resetBusy ? "Resetting…" : "Reset"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
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
// The whole right-of-the-logo half of the app header, session-gated as one
// unit. Both halves need to know whether anyone is signed in — the nav links
// into authenticated routes, the avatar is the account — and AppHeader is a
// server component barred from importing `@/server/*` (AGENTS.md invariant 6),
// so it cannot answer that itself. One island, one `getSession()`: gating the
// nav separately would mean a second fetch of the same fact.
//
// Signed out, this renders nothing at all. Before PR #55 the header offered a
// signed-out visitor "Trips" and "Playbooks" — links into pages they cannot
// see (Mitchell, preview feedback: "Trips and playbooks shouldnt render when
// signed out"). The logo stays, because it is the way back to the landing
// page.
export function HeaderSessionChrome({ demoResetEnabled = false }: { demoResetEnabled?: boolean } = {}) {
  const user = useSessionUser();
  if (!user) return null;

  return (
    <>
      <nav className="flex items-center gap-1 pl-2">
        <Link href="/" className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
          Trips
        </Link>
        <Link
          href="/playbooks"
          className="rounded-sm px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink"
        >
          Playbooks
        </Link>
      </nav>
      <div className="ml-auto flex items-center">
        {/* AccountMenuFor, not AccountMenuFromSession: the latter resolves the
            session itself, which would make this header fetch the same fact
            twice. We already have `user`. */}
        <AccountMenuFor user={user} demoResetEnabled={demoResetEnabled} />
      </div>
    </>
  );
}

// One `getSession()` per component that needs identity. The header has exactly
// one such component (HeaderSessionChrome), which passes the resolved user down
// to AccountMenuFor rather than mounting a second resolver — CodeRabbit caught
// the first version doing precisely that, and the comment here claiming
// otherwise was a lie the code did not keep.
function useSessionUser() {
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

  return user;
}

// The session-independent half: given a user, wire up the menu. Both entry
// points below render this — HeaderSessionChrome with the user it already
// resolved, AccountMenuFromSession with one it resolves itself.
function AccountMenuFor({
  user,
  demoResetEnabled = false,
}: {
  user: { name?: string | null; email?: string | null };
  demoResetEnabled?: boolean;
}) {
  // A hard reload, not a router.push: this can be confirmed from any page
  // (a trip page whose own trip was just deleted included), and the freshly
  // seeded trip needs every client-fetched view — Home's trip list, any open
  // trip board — to refetch from scratch rather than reconcile stale state.
  async function handleResetDemoData() {
    const result = await resetDemoData();
    if (!result.ok) throw new Error(result.error.message);
    window.location.reload();
  }

  return (
    <AccountMenu
      name={user.name ?? user.email ?? "Account"}
      email={user.email ?? ""}
      onSignOut={() => void signOut({ callbackUrl: "/" })}
      demoResetEnabled={demoResetEnabled}
      onResetDemoData={demoResetEnabled ? handleResetDemoData : undefined}
    />
  );
}

// Standalone entry point: resolves the session itself. Kept for callers that
// have no user to hand (its own tests today).
export function AccountMenuFromSession({ demoResetEnabled = false }: { demoResetEnabled?: boolean } = {}) {
  const user = useSessionUser();
  if (!user) return null;
  return <AccountMenuFor user={user} demoResetEnabled={demoResetEnabled} />;
}
