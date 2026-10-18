"use client";

import { useEffect } from "react";
import { HOME_PATH } from "@/lib/homePath";
import { hasSignedInHint } from "@/lib/sessionHint";

/**
 * Sends a hinted visitor on from the landing to Home in the two cases the root
 * layout's inline script (`LEAVE_LANDING_IF_SIGNED_IN`) cannot see, since it
 * runs once per full load and never on a client render:
 *
 * - **A client navigation to `/`**: the 404's *Caesura home*, Back from
 *   `/signin`, the front-door logo.
 * - **A back-forward-cache restore.** `/` is static, so the browser may keep
 *   it whole, and a restore runs no script and no effect — only `pageshow`,
 *   with `persisted`. The listener registered here is kept with the page, so
 *   it is there to hear it. Here and not in the inline script, which must stay
 *   short (its docstring says why).
 *
 * Reads only the browser's cookie, so `/` stays static (ADR-078). Renders
 * nothing.
 */
export function LeaveLandingIfSignedIn() {
  useEffect(() => {
    const leave = () => {
      if (hasSignedInHint(document.cookie)) window.location.replace(HOME_PATH);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) leave();
    };
    leave();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}
