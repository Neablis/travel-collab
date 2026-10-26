"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useKnownSessionUser, useSessionUser } from "@/components/account/useSessionUser";
import { clearWelcomeCue, readWelcomeCue } from "@/lib/welcomeCue";

/**
 * How the moment goes (spec decisions 6 and 8, option A).
 *
 * - `breathe`: the launch overlay while the page loads; the strokes breathe
 *   (`om-save-breathe`) and nothing leaves.
 * - `fade`: the page was ready within about 300ms, so the overlay just fades
 *   and a fast launch reads as the OS splash ending.
 * - `unlock`: the strokes part, the tile opens, the overlay goes.
 * - `welcome`: after a sign-in, a short hold on the mark, then the unlock.
 */
export type WelcomePhase = "breathe" | "fade" | "unlock" | "welcome";

// How long each phase is on screen before it unmounts, a little past the end
// of its keyframes in `globals.css` (`.welcome-moment`), which are composed from
// the motion tokens. Timed here rather than on `animationend` because under
// reduced motion nothing animates, and the moment must still leave.
const ON_SCREEN_MS = { fade: 200, unlock: 400, welcome: 900, named: 1600 } as const;

// The tile's edge, in px. The full size is the iOS startup image's mark
// (`scripts/generate-og-assets.mjs`, `SPLASH_MARK`), so the splash hands over
// to this without the mark changing size.
const MARK_PX = { full: 96, small: 64 } as const;

/**
 * The welcome moment: the mark unlocks and the moment leaves on its own.
 *
 * `full` covers the screen in the page's own colour (a PWA launch, a sign-in on
 * a phone); `small` is the mark alone over the page (a sign-in on desktop).
 * **Neither blocks anything** (decision 4): no focus trap, nothing made
 * `inert`, nothing focusable inside, and `globals.css` gives it no pointer
 * events, so a click or a key goes to the page underneath from the first frame.
 *
 * Hidden from assistive tech: a mark that leaves within a second is decoration,
 * and "Welcome, {name}" is said through `WelcomeAnnouncement` instead, a live
 * region that is already on the page when the words arrive.
 */
export function WelcomeMoment({
  size,
  name,
  phase = "welcome",
  onDone,
}: {
  size: "full" | "small";
  /** After a signup only: adds "Welcome, {name}". */
  name?: string;
  phase?: WelcomePhase;
  onDone?: () => void;
}) {
  // A ref, so a caller's inline `onDone` does not restart the clock each render.
  const done = useRef(onDone);
  done.current = onDone;
  const named = Boolean(name);
  useEffect(() => {
    if (phase === "breathe") return;
    const ms = phase === "welcome" && named ? ON_SCREEN_MS.named : ON_SCREEN_MS[phase];
    const timer = setTimeout(() => done.current?.(), ms);
    return () => clearTimeout(timer);
  }, [phase, named]);

  return (
    <div
      data-testid="welcome-moment"
      aria-hidden
      className="welcome-moment"
      data-size={size}
      data-phase={phase}
      data-named={name ? "" : undefined}
    >
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={MARK_PX[size]} pulsing={phase === "breathe"} className="welcome-mark" />
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
function WelcomeAnnouncement({ name }: { name: string | undefined }) {
  return (
    <p aria-live="polite" className="sr-only">
      {name ? welcomeLine(name) : ""}
    </p>
  );
}

/**
 * Plays the moment once after a sign-in, from the `tc_welcome` cookie
 * `recordSignIn` set (decision 19), and spends the cookie at once so a refresh
 * does not replay it. Mounted in the app shell, under the session provider,
 * which is where the new account's name is.
 *
 * Full-screen under a finger or in the installed app, small otherwise. Under
 * reduced motion only the words (ADR-082 decision 2: an overlay unmounts at
 * once), and nothing on a home-screen launch: the cue is left for
 * `LaunchOverlay`, which is already this moment there, whichever of the two
 * hydrates first.
 */
export function WelcomeCue() {
  const user = useKnownSessionUser();
  const [cue, setCue] = useState<{ size: "full" | "small" | null; signup: boolean } | null>(null);

  useEffect(() => {
    const kind = readWelcomeCue(document.cookie);
    if (kind === null || document.documentElement.hasAttribute("data-launch")) return;
    clearWelcomeCue();
    const size = prefersReducedMotion() ? null : wantsFullScreen() ? "full" : "small";
    setCue({ size, signup: kind === "signup" });
  }, []);

  const name = cue?.signup ? (user?.name ?? undefined) : undefined;
  return (
    <>
      <WelcomeAnnouncement name={name} />
      {cue?.size ? <WelcomeMoment size={cue.size} name={name} onDone={() => setCue(null)} /> : null}
    </>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wantsFullScreen(): boolean {
  // jsdom does not always ship `matchMedia` (useIsPhone's guard).
  if (typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * The PWA's cold-launch overlay (decision 6). Server HTML in the root layout,
 * so it can cover the first paint; `globals.css` shows it only once
 * `LAUNCH_SCRIPT` has marked the document a home-screen launch, so no other
 * load ever draws it.
 *
 * It leaves on hydration: a fade when the page was ready within about 300ms,
 * the unlock when it took longer, and at once under reduced motion. It is never
 * hidden and then shown, which would put a blank frame between the splash and
 * the app.
 *
 * A launch that is also the first page after a sign-in spends the welcome cue
 * here (`WelcomeCue` leaves it while `data-launch` is set), and a signup's
 * plays "Welcome, {name}". When it draws nothing, a signup's is still said.
 */
export function LaunchOverlay() {
  const [launch, setLaunch] = useState<
    { phase: WelcomePhase; signup: false } | { signup: true; nameWaitMs: number } | "gone" | "said"
  >({ phase: "breathe", signup: false });

  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-launch")) {
      setLaunch("gone");
      return;
    }
    const kind = readWelcomeCue(document.cookie);
    if (kind !== null) clearWelcomeCue();
    // Time since the launch began, which is when the OS splash went up. Past
    // the fail-safe, `globals.css` has already faded the overlay out, and
    // showing it again would be the blank-frame flicker decision 6 forbids.
    const since = performance.now();
    if (prefersReducedMotion() || since >= LAUNCH_FAILSAFE_MS) {
      root.removeAttribute("data-launch");
      setLaunch(kind === "signup" ? "said" : "gone");
      return;
    }
    if (kind === "signup") {
      // Breathing past the fail-safe would let the CSS fade the sheet before
      // the welcome brings it back.
      setLaunch({ signup: true, nameWaitMs: Math.min(NAME_WAIT_MS, LAUNCH_FAILSAFE_MS - since) });
    } else if (kind === "signin") setLaunch({ phase: "welcome", signup: false });
    else setLaunch({ phase: since < FAST_LAUNCH_MS ? "fade" : "unlock", signup: false });
  }, []);

  if (launch === "gone") return null;
  if (launch === "said") return <SessionAnnouncement />;
  const leave = () => {
    document.documentElement.removeAttribute("data-launch");
    setLaunch("gone");
  };
  if (launch.signup) return <NamedLaunch nameWaitMs={launch.nameWaitMs} onDone={leave} />;
  return (
    <div className="launch-overlay">
      <WelcomeMoment size="full" phase={launch.phase} onDone={leave} />
    </div>
  );
}

// The root layout has no session provider, so these ask the session themselves,
// and are mounted only on a signup's launch so no other load pays for the request.
function SessionAnnouncement() {
  return <WelcomeAnnouncement name={useSessionUser()?.name ?? undefined} />;
}

// Breathes until the name is known or `nameWaitMs` has passed, then welcomes
// with whatever it has. The name is fixed from then on: `data-named` lengthens
// the hold, and re-timing a running animation snaps a fading sheet back, the
// hidden-then-shown frame decision 6 forbids. A later name is still said.
function NamedLaunch({ nameWaitMs, onDone }: { nameWaitMs: number; onDone: () => void }) {
  const user = useSessionUser();
  const [welcome, setWelcome] = useState<{ name: string | undefined } | null>(null);
  useEffect(() => {
    if (welcome) return;
    if (user !== undefined) {
      setWelcome({ name: user?.name ?? undefined });
      return;
    }
    const timer = setTimeout(() => setWelcome({ name: undefined }), nameWaitMs);
    return () => clearTimeout(timer);
  }, [user, welcome, nameWaitMs]);

  return (
    <>
      <WelcomeAnnouncement name={user?.name ?? undefined} />
      <div className="launch-overlay">
        <WelcomeMoment size="full" phase={welcome ? "welcome" : "breathe"} name={welcome?.name} onDone={onDone} />
      </div>
    </>
  );
}

// Long enough for a session read on a cold launch to answer most of the time;
// past it, the person has watched a breathing mark for long enough.
const NAME_WAIT_MS = 600;

// Decision 6's "about 300ms": under it, the splash simply ending reads better
// than an animation the person had no time to see start.
const FAST_LAUNCH_MS = 300;

// The CSS fail-safe's delay (`globals.css`, `.launch-overlay`): a launch that
// never hydrates (offline, a chunk that failed to load) still uncovers the page.
const LAUNCH_FAILSAFE_MS = 3000;
