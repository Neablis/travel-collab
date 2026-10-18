"use client";

import { useEffect } from "react";
import { HOME_PATH } from "@/lib/homePath";
import { hasSignedInHint } from "@/lib/sessionHint";

/** False once this document has mounted the component; see `headScriptLeft`. */
let firstMount = true;

/**
 * Whether this document was loaded at `/` itself, in which case the root
 * layout's head script has already called `location.replace` and Home is on
 * its way. Leaving again would cancel that request and start a second render
 * of Home. Read from the navigation entry, not `location`, because a client
 * navigation from `/signin` is also at `/` by the time this mounts. A browser
 * with no navigation entry is treated as not loaded here: a second request is
 * a cost, a landing that never leaves is a bug.
 */
function headScriptLeft(): boolean {
  const entry = performance.getEntriesByType?.("navigation")[0];
  return entry !== undefined && new URL(entry.name).pathname === "/";
}

/**
 * Sends a hinted visitor on from the landing to Home in the two cases the root
 * layout's inline script (`LEAVE_LANDING_IF_SIGNED_IN`) cannot see, since it
 * runs once per full load and never on a client render:
 *
 * - **A client navigation to `/`**: the 404's *Caesura home*, Back from
 *   `/signin`, the front-door logo. The first mount in a document loaded at
 *   `/` is skipped, because the head script already left; a later one in the
 *   same document is not.
 * - **A back-forward-cache restore.** `/` is static, so the browser may keep
 *   it whole, and a restore runs no script and no effect — only `pageshow`,
 *   with `persisted`. The listener registered here is kept with the page, so
 *   it is there to hear it. Here and not in the inline script, which must stay
 *   short (its docstring says why).
 *
 * `location.replace`, not the router: a full load goes through the proxy,
 * which clears a stale hint on its way to `/signin`, and it matches what the
 * head script does. The cost is that the landing stays up until Home's
 * response commits (ADR-078).
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
    const skip = firstMount && headScriptLeft();
    firstMount = false;
    if (!skip) leave();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}
