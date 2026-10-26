"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useSessionUser } from "@/components/account/useSessionUser";
import { type WelcomeKind, clearWelcomeCue, readWelcomeCue } from "@/lib/welcomeCue";

/**
 * How the moment goes (spec decisions 6 and 8, option A).
 *
 * - `breathe`: the launch overlay while the page loads; the strokes breathe
 *   (`om-save-breathe`) and nothing leaves.
 * - `fade`: the page was ready within about 300ms, so the overlay just fades
 *   and a fast launch reads as the OS splash ending.
 * - `unlock`: the strokes part, the tile opens, the overlay goes.
 * - `welcome`: after a sign-in, a hold on the mark and "Welcome, {name}", then
 *   the unlock.
 */
export type WelcomePhase = "breathe" | "fade" | "unlock" | "welcome";

// How long each phase is on screen before it unmounts, a little past the end
// of its keyframes in `globals.css` (`.welcome-moment`), which are composed from
// the motion tokens. Timed here rather than on `animationend` because under
// reduced motion nothing animates, and the moment must still leave.
const ON_SCREEN_MS = { fade: 200, unlock: 400 } as const;

// The welcome holds the mark this long, then unlocks: `--welcome-hold`, set
// here because `LaunchOverlay` shortens it. The full beats are the slow motion
// token twice, and three times when it says "Welcome, {name}"; the unlock is
// the fast and slow tokens, with a little over before it unmounts.
const HOLD_MS = { unnamed: 480, named: 720 } as const;
const UNLOCK_MS = 430;

// The tile's edge, in px: the iOS startup image's mark
// (`scripts/generate-og-assets.mjs`, `SPLASH_MARK`), so the splash hands over
// to this without the mark changing size.
const MARK_PX = 96;

/**
 * The welcome moment: the mark unlocks and the moment leaves on its own.
 *
 * It covers the screen in the page's own colour, so the page is not seen until
 * it goes: a home-screen launch, and since Mitchell's walk every sign-in at
 * every width. As the launch overlay it takes the pointer (`globals.css`), so a
 * tap on the blank splash does not land on a page nobody can see. It holds
 * nothing else: no focus trap, nothing made `inert`, nothing focusable inside.
 * Tab can still reach the page under it for the second or so it is up, which
 * is left: making the page `inert` would mean wrapping every route in the root
 * layout for a moment that has gone before a keyboard user has found anything.
 *
 * Hidden from assistive tech: a mark that leaves within a second or so is
 * decoration, and "Welcome, {name}" is said through `WelcomeAnnouncement`
 * instead, a live region that is already on the page when the words arrive.
 */
export function WelcomeMoment({
  name,
  phase = "welcome",
  holdMs = name ? HOLD_MS.named : HOLD_MS.unnamed,
  onDone,
}: {
  /** After a sign-in: adds "Welcome, {name}". */
  name?: string;
  phase?: WelcomePhase;
  /** The welcome's hold on the mark before it unlocks; the full beat by default. */
  holdMs?: number;
  onDone?: () => void;
}) {
  // A ref, so a caller's inline `onDone` does not restart the clock each render.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (phase === "breathe") return;
    const ms = phase === "welcome" ? holdMs + UNLOCK_MS : ON_SCREEN_MS[phase];
    const timer = setTimeout(() => done.current?.(), ms);
    return () => clearTimeout(timer);
  }, [phase, holdMs]);

  return (
    <div
      data-testid="welcome-moment"
      aria-hidden
      className="welcome-moment"
      data-phase={phase}
      // eslint-disable-next-line no-restricted-syntax -- a hold shortened at run time cannot be a static token
      style={phase === "welcome" ? ({ "--welcome-hold": `${holdMs}ms` } as CSSProperties) : undefined}
    >
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={MARK_PX} pulsing={phase === "breathe"} className="welcome-mark" />
        {name ? <p className="welcome-line font-display text-xl font-semibold text-ink">{welcomeLine(name)}</p> : null}
      </div>
    </div>
  );
}

const welcomeLine = (name: string) => `Welcome, ${name}`;

// Rendered before it has anything to say: a live region inserted with its
// words already in it is not reliably read out. `aria-live` rather than
// `role="status"`: it sits in every app page, where the save light already
// owns the one status role that specs find by role alone.
// The words go once said: the root layout outlives client navigation, and a
// browse-mode reader would otherwise meet them on every page.
function WelcomeAnnouncement({ name }: { name: string | undefined }) {
  const [said, setSaid] = useState(false);
  useEffect(() => {
    if (!name) return;
    const timer = setTimeout(() => setSaid(true), SAID_MS);
    return () => clearTimeout(timer);
  }, [name]);
  return (
    <p aria-live="polite" className="sr-only">
      {name && !said ? welcomeLine(name) : ""}
    </p>
  );
}

// Longer than any moment, so the words never leave before the mark does, and
// long enough for a polite announcement queued behind other speech.
const SAID_MS = 5000;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The PWA's cold-launch overlay (decision 6), and the welcome splash after a
 * sign-in. Server HTML in the root layout, so it can cover the first paint;
 * `globals.css` shows it only once `LAUNCH_SCRIPT` has marked the document a
 * home-screen launch or found the `tc_welcome` cookie `recordSignIn` set
 * (decision 19), so no other load ever draws it.
 *
 * A launch leaves on hydration: a fade when the page was ready within about
 * 300ms, the unlock when it took longer, and at once under reduced motion. It
 * is never hidden and then shown, which would put a blank frame between the
 * splash and the app.
 *
 * After a sign-in it spends the cue, so a refresh does not replay it, waits up
 * to `NAME_WAIT_MS` for the account's name, and says "Welcome, {name}" before
 * the unlock. Under reduced motion that is the same hold with nothing moving,
 * so the page is still handed over whole. When it draws nothing, the name is
 * still said.
 *
 * The splash is up about 1.2 to 1.6s in all: the welcome's hold gives back
 * whatever hydration and the name wait already took. Only a page that hydrates
 * late holds it longer, since nothing can lift it before then but the CSS
 * fail-safe; the worst is a hydration just inside that, plus the unlock.
 */
export function LaunchOverlay() {
  // `null` once nothing is drawn. The overlay is always the first child, so the
  // one the server drew is the one that welcomes, and its breathing mark runs
  // on through hydration.
  const [launch, setLaunch] = useState<{ phase: WelcomePhase; name?: string; holdMs?: number } | null>({
    phase: "breathe",
  });
  // After a sign-in only: how long the overlay waits for the name, or `null`
  // when it draws nothing and the name is only said.
  const [welcomed, setWelcomed] = useState<{ nameWaitMs: number | null } | null>(null);
  // Read once: `next dev`'s StrictMode runs the effect twice, and the first run
  // spends the cue the second would otherwise find gone.
  const cue = useRef<{ kind: WelcomeKind | null; upAt: number } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-launch")) {
      setLaunch(null);
      return;
    }
    cue.current ??= { kind: readWelcomeCue(document.cookie), upAt: Number(root.getAttribute("data-launch")) || 0 };
    const { kind, upAt } = cue.current;
    if (kind !== null) clearWelcomeCue();
    // Since the splash went up, which is also when the CSS fail-safe's clock
    // started. Past it, `globals.css` has already faded the overlay out, and
    // showing it again would be the blank-frame flicker decision 6 forbids.
    const since = performance.now() - upAt;
    if (since >= LAUNCH_FAILSAFE_MS || (kind === null && prefersReducedMotion())) {
      root.removeAttribute("data-launch");
      setLaunch(null);
      if (kind !== null) setWelcomed({ nameWaitMs: null });
      return;
    }
    // Breathing past the fail-safe would let the CSS fade the sheet before the
    // welcome brings it back.
    if (kind !== null) setWelcomed({ nameWaitMs: Math.min(NAME_WAIT_MS, LAUNCH_FAILSAFE_MS - since) });
    // From navigation start here, not the stamp: on a launch that is when the
    // OS splash went up, and "fast" is fast as the person saw it.
    else setLaunch({ phase: performance.now() < FAST_LAUNCH_MS ? "fade" : "unlock" });
  }, []);

  // The name and the hold are fixed once the welcome starts: re-timing a
  // running animation snaps a fading sheet back, the hidden-then-shown frame
  // decision 6 forbids. A later name is still said.
  const welcome = useCallback((name: string | undefined) => {
    const shown = performance.now() - (cue.current?.upAt ?? 0);
    const holdMs = Math.max(0, Math.min(name ? HOLD_MS.named : HOLD_MS.unnamed, SPLASH_MS - UNLOCK_MS - shown));
    setLaunch((now) => (now?.phase === "breathe" ? { phase: "welcome", name, holdMs } : now));
  }, []);
  const leave = () => {
    document.documentElement.removeAttribute("data-launch");
    setLaunch(null);
  };
  return (
    <>
      {launch ? (
        <div className="launch-overlay">
          <WelcomeMoment phase={launch.phase} name={launch.name} holdMs={launch.holdMs} onDone={leave} />
        </div>
      ) : null}
      {welcomed ? <WelcomeName nameWaitMs={welcomed.nameWaitMs} onWelcome={welcome} /> : null}
    </>
  );
}

// Says the account's name, and hands it to the overlay once known or once
// `nameWaitMs` has passed. The root layout has no session provider, so this
// asks the session itself, and is mounted only after a sign-in so no other
// load pays for the request.
function WelcomeName({
  nameWaitMs,
  onWelcome,
}: {
  nameWaitMs: number | null;
  onWelcome: (name: string | undefined) => void;
}) {
  const user = useSessionUser();
  useEffect(() => {
    if (nameWaitMs === null) return;
    if (user !== undefined) {
      onWelcome(user?.name ?? undefined);
      return;
    }
    const timer = setTimeout(() => onWelcome(undefined), nameWaitMs);
    return () => clearTimeout(timer);
  }, [user, nameWaitMs, onWelcome]);
  return <WelcomeAnnouncement name={user?.name ?? undefined} />;
}

// Long enough for a session read on a cold load to answer most of the time;
// past it, the person has watched a breathing mark for long enough.
const NAME_WAIT_MS = 600;

// The spec's "about 1.2 to 1.6s" for a sign-in's splash, from going up to gone.
const SPLASH_MS = 1600;

// Decision 6's "about 300ms": under it, the splash simply ending reads better
// than an animation the person had no time to see start.
const FAST_LAUNCH_MS = 300;

// The CSS fail-safe's delay (`globals.css`, `.launch-overlay`): a launch that
// never hydrates (offline, a chunk that failed to load) still uncovers the page.
const LAUNCH_FAILSAFE_MS = 3000;
