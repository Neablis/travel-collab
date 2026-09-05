"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSession, signOut } from "next-auth/react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { AccountSettingsSheet } from "@/components/account/AccountSettingsSheet";
import { usePreferences } from "@/components/account/PreferencesProvider";
import { displayNameFor } from "@/lib/displayName";
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
  // src/lib/demoDataReset.ts) — a deliberate addition to the design's
  // "Your account" + "Sign out" dropdown, real and never rendered outside
  // preview. `undefined` when `demoResetEnabled` is false, same as
  // `onSignOut` — nothing to call when the item doesn't exist.
  demoResetEnabled?: boolean;
  onResetDemoData?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
        // `phone-hit-44` (globals.css) grows the TAP target to 44px below
        // 768px without moving the 30px circle — see that rule for why the
        // avatar in particular needs it.
        className="phone-hit-44 shrink-0 rounded-full border border-hairline bg-moss text-xs font-semibold text-slate hover:bg-moss hover:text-slate"
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
        {/* M17. Task 8b.2 omitted this item rather than ship one that did
            nothing — the design's own "Your account" — and it has been absent
            since, never a "not built yet" flash. It is real now: it opens the
            account settings Sheet. Above Sign out, the design's order. */}
        <Button
          variant="ghost"
          className="mt-1 h-auto w-full justify-start rounded-md px-2.5 py-2 text-sm font-normal text-ink"
          onClick={() => {
            setOpen(false);
            setAccountOpen(true);
          }}
        >
          Your account
        </Button>
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
      {/* Mounted only while open, deliberately: the Sheet reads preferences
          through `useAccountPreferences`, which throws outside a provider, and
          this menu is rendered bare in its own unit tests. Opening it is what
          makes the provider a requirement, which is the honest place for that
          requirement to bite. */}
      {accountOpen && (
        <AccountSettingsSheet open onOpenChange={setAccountOpen} email={email} />
      )}
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

/** The session fields the header reads. `id` is always set by the `session` callback. */
type SessionUser = { id?: string | null; name?: string | null; email?: string | null };

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
      {/* Hidden below 768px, and the reason is now per-scope rather than one
          sentence — SPEC §22 made the tab bar's contents change with route:

          - Outside a trip the bar IS Trips + Playbooks, so these two links are
            a second, smaller, less reachable copy of it. RULES.md 4.
          - Inside a trip the bar is Plan / Map / Notebook, so there is no
            duplication to remove. They stay hidden anyway because §22 settles
            both destinations elsewhere: Trips is `TripHeader`'s `← Your trips`,
            and Playbooks is deliberately two taps ("if telemetry shows people
            browse the library mid-trip, the fix is an entry point inside the
            trip, not a fifth permanent tab").

          Stated in full because the first bullet alone would justify this hide
          on a page where it is not true, and a later reader could then "fix"
          the trip case by un-hiding them. (Copilot, PR #143.)

          The avatar below deliberately stays at every width — RULES.md 1 puts
          account scope in the top bar, the tab bar does not carry it, and after
          §22 it is the ONLY account-scope control a phone has.

          A CSS breakpoint, not `useIsPhone()`: that hook starts `false` on
          the server and for the first client paint by design, so a JS gate
          would render both navigations for one paint on every phone load —
          exactly the duplication this removes. Same reason
          `AssistantBubble.tsx:38` uses `max-md:`. `hidden md:flex` rather
          than `md:hidden` inverted, because this element's shown state is
          `flex`. */}
      <nav className="hidden items-center gap-1 pl-2 md:flex">
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
  // `id` too, since M17: the display-name seam's last resort derives a handle
  // from it (`displayNameFor`), and it is already on the session — the JWT
  // `session` callback sets `session.user.id` on every call (authConfig.ts).
  const [user, setUser] = useState<SessionUser | null>(null);

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
  user: SessionUser;
  demoResetEnabled?: boolean;
}) {
  // Read tolerantly (defaults outside a provider), because this component is
  // rendered bare in its own tests and a name is display, not an operation.
  const preferences = usePreferences();
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
      // Through the seam, not a fourth hand-spelled fallback. This line used to
      // read `user.name ?? user.email ?? "Account"` — the same chain
      // `displayNameFor` owns, minus the chosen display name M17 put at the
      // front of it and minus the "never render a raw identifier" rule, so a
      // name typed into account settings would not have reached the one place
      // it is most obviously meant to show.
      name={displayNameFor({
        userId: user.id ?? "",
        displayName: preferences.displayName,
        name: user.name,
        email: user.email,
      })}
      email={user.email ?? ""}
      // `/welcome`, not `/` — sign-out must not depend on a redirect it races.
      // `signOut` POSTs to /api/auth/signout (whose response clears the session
      // cookie) and then sets `window.location.href`. Pointed at `/`, the
      // landing depends on `src/proxy.ts` bouncing a signed-out visitor on to
      // `/welcome` — but if the navigation is issued before the browser has
      // committed that Set-Cookie, the `/` request still carries a valid
      // session, the proxy passes it through, and the user is left on a
      // signed-out-but-still-rendering-Home page. Measured on Next 16:
      // `GET /` came back 200 instead of 307 in 4 of 16 runs of
      // e2e/m15-front-door.spec.ts (0 of 16 on Next 15, which is why this
      // surfaced with that upgrade and not before). `/welcome` is public, so
      // going straight there is correct whether or not the cookie has landed
      // yet — and it is where `/` was going to send them anyway.
      onSignOut={() => void signOut({ callbackUrl: "/welcome" })}
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
