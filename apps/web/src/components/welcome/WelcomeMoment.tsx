"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useKnownSessionUser } from "@/components/account/useSessionUser";
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
      className="welcome-moment"
      data-size={size}
      data-phase={phase}
      data-named={name ? "" : undefined}
    >
      <div className="flex flex-col items-center gap-4">
        <BrandMark size={MARK_PX[size]} pulsing={phase === "breathe"} className="welcome-mark" />
        {name ? <p className="welcome-line font-display text-xl font-semibold text-ink">Welcome, {name}</p> : null}
      </div>
    </div>
  );
}

/**
 * Plays the moment once after a sign-in, from the `tc_welcome` cookie
 * `recordSignIn` set (decision 19), and spends the cookie at once so a refresh
 * does not replay it. Mounted in the app shell, under the session provider,
 * which is where the new account's name is.
 *
 * Full-screen under a finger or in the installed app, small otherwise. Nothing
 * extra on a home-screen launch: `LaunchOverlay` is already this moment there.
 */
export function WelcomeCue() {
  const user = useKnownSessionUser();
  const [cue, setCue] = useState<{ size: "full" | "small"; signup: boolean } | null>(null);

  useEffect(() => {
    const kind = readWelcomeCue(document.cookie);
    if (kind === null) return;
    clearWelcomeCue();
    if (document.documentElement.hasAttribute("data-launch")) return;
    setCue({ size: wantsFullScreen() ? "full" : "small", signup: kind === "signup" });
  }, []);

  if (cue === null) return null;
  return (
    <WelcomeMoment
      size={cue.size}
      name={cue.signup ? (user?.name ?? undefined) : undefined}
      onDone={() => setCue(null)}
    />
  );
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
 */
export function LaunchOverlay() {
  const [phase, setPhase] = useState<WelcomePhase | "gone">("breathe");

  useEffect(() => {
    const root = document.documentElement;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!root.hasAttribute("data-launch") || reduce) {
      root.removeAttribute("data-launch");
      setPhase("gone");
      return;
    }
    // Time since the launch began, which is when the OS splash went up.
    setPhase(performance.now() < FAST_LAUNCH_MS ? "fade" : "unlock");
  }, []);

  if (phase === "gone") return null;
  return (
    <div className="launch-overlay">
      <WelcomeMoment
        size="full"
        phase={phase}
        onDone={() => {
          document.documentElement.removeAttribute("data-launch");
          setPhase("gone");
        }}
      />
    </div>
  );
}

// Decision 6's "about 300ms": under it, the splash simply ending reads better
// than an animation the person had no time to see start.
const FAST_LAUNCH_MS = 300;
