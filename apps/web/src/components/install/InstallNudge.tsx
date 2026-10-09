"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { dismissInstallNudge, installNudgeDismissed, isReturningVisitor } from "@/lib/installPrompt";
import { useIsPhone } from "@/lib/useIsPhone";
import { SITE_NAME } from "@/lib/siteMetadata";
import { useInstallApp } from "./InstallApp";

/** How long a trip has to be open before the nudge may appear. */
export const INSTALL_NUDGE_DELAY_MS = 4000;

// Every surface this app opens over a page is a Radix Dialog, Popover or Menu
// — sheets, the activity editor, Trip settings, the assistant, the account
// menu — and each renders one of these roles only while it is open. There is
// no app-wide "something is open" flag to read, so the DOM is the signal.
const OPEN_SURFACE = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * *Keep Caesura on your home screen* — the one install nudge (M39; Mitchell's
 * option B, 2026-10-09). A slim row under a phone trip's pinned header, with
 * **Install** and **Not now**.
 *
 * It asks once it has earned the right to, and never otherwise:
 *
 *  - only where the caller says (`eligible` — a signed-in trip's Overview or
 *    Plan), only below 768px, and only where installing would work;
 *  - only on a device that has opened the app on a second day, so never on a
 *    first visit;
 *  - only after the trip has been open `INSTALL_NUDGE_DELAY_MS`, and only
 *    while the page is at its top, so the row is never inserted above content
 *    someone is reading and shoves it down;
 *  - never while a sheet, dialog or menu is open over the page.
 *
 * **Not now** hides it on this device for good; the account menu's *Install
 * app* row is still there. Storage that throws reads as "never ask".
 */
export function InstallNudge({ eligible }: { eligible: boolean }) {
  const { route, install, steps } = useInstallApp();
  const isPhone = useIsPhone();
  // Read after mount: storage is the browser's, and the server render must
  // agree with the first client frame (nothing).
  const [earned, setEarned] = useState(false);
  // Pressed this page: Not now, or Install (the browser's dialog or the iOS
  // steps take over from there).
  const [answered, setAnswered] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setEarned(isReturningVisitor() && !installNudgeDismissed());
  }, []);

  const candidate = eligible && isPhone && route !== null && earned && !answered;

  // The delay, then the first moment the page is at its top.
  useEffect(() => {
    if (!candidate || settled) return;
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timer = undefined;
      settleAtTop();
    }, INSTALL_NUDGE_DELAY_MS);
    function settleAtTop() {
      if (timer !== undefined) return;
      if (window.scrollY <= 0) setSettled(true);
    }
    window.addEventListener("scroll", settleAtTop, { passive: true });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("scroll", settleAtTop);
    };
  }, [candidate, settled]);

  const surfaceOpen = useSurfaceOpen(candidate && settled);

  return (
    <>
      {candidate && settled && !surfaceOpen && (
        <section
          aria-label={`Install ${SITE_NAME}`}
          className="flex items-center gap-2 border-b border-hairline bg-surface py-1 pr-1 pl-3 md:hidden"
        >
          <BrandMark size={20} />
          <span className="min-w-0 flex-1 text-sm text-ink">Keep {SITE_NAME} on your home screen</span>
          <Button
            variant="ghost"
            size="touch"
            onClick={() => {
              setAnswered(true);
              dismissInstallNudge();
            }}
          >
            Not now
          </Button>
          <Button
            variant="primary"
            size="touch"
            onClick={() => {
              setAnswered(true);
              install();
            }}
          >
            Install
          </Button>
        </section>
      )}
      {steps}
    </>
  );
}

// Whether a dialog, sheet, popover or menu is open anywhere on the page.
// Watched only while the nudge would otherwise be on screen.
function useSurfaceOpen(watch: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!watch) return;
    const check = () => setOpen(document.querySelector(OPEN_SURFACE) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [watch]);
  return open;
}
