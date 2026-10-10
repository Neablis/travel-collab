"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { dismissInstallNudge, installNudgeDismissed, isReturningVisitor } from "@/lib/installPrompt";
import { useIsPhone } from "@/lib/useIsPhone";
import { SITE_NAME } from "@/lib/siteMetadata";
import { useInstallApp } from "./InstallApp";

/**
 * *Keep Caesura on your home screen* — the phone's one install nudge, as a
 * card on the trips list.
 *
 * **Where it lives moved on 2026-10-10.** It was a slim row under a phone
 * trip's pinned header, and the desktop's way to install was a row in the
 * account menu; Mitchell, on the preview: "Find a better place for install
 * app. I am not liking it in this place." What he chose: a *Get the app*
 * button in the desktop top nav (`GetTheAppButton`), and on a phone the
 * account menu's row plus this card on Home — the list a returning reader
 * opens to, where an in-flow card covers nothing and pushes nothing they
 * were reading. So the old row's delay, wait-for-the-top and
 * no-sheet-open rules are gone with the placement they protected.
 *
 * What is kept is when it has earned the right to ask (Mitchell's option B,
 * 2026-10-09):
 *
 *  - only below 768px, and only where installing would work (a stashed
 *    `beforeinstallprompt`, or Safari on iOS) — never inside the installed
 *    app;
 *  - only on a device that has opened the app on a second day, so never on a
 *    first visit;
 *  - **once**: *Not now* hides it on this device for good, and so does
 *    *Install*, whatever comes of it (Chromium offers again on the next load
 *    after a cancelled dialog, and Safari never says whether the steps were
 *    followed). The same storage key as the old row, so a reader who said
 *    *Not now* to that is not asked again here. Storage that throws reads as
 *    "never ask". The account menu's *Install app* row stays.
 */
export function InstallNudge() {
  const { route, install, steps } = useInstallApp();
  const isPhone = useIsPhone();
  // Read after mount: storage is the browser's, and the server render must
  // agree with the first client frame (nothing).
  const [earned, setEarned] = useState(false);
  // Pressed on this page: Not now, or Install (the browser's dialog or the
  // iOS steps take over from there).
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setEarned(isReturningVisitor() && !installNudgeDismissed());
  }, []);

  const shown = isPhone && route !== null && earned && !answered;

  return (
    <>
      {shown && (
        <Card
          role="region"
          aria-label={`Install ${SITE_NAME}`}
          className="flex flex-col gap-3 p-4 md:hidden"
        >
          <div className="flex items-center gap-3">
            {/* The app's own mark, at the size of an icon on a home screen:
                this card is the one that puts it there. */}
            <BrandMark size={32} />
            <div className="min-w-0 flex-1">
              <Text as="span" className="block font-semibold">
                Keep {SITE_NAME} on your home screen
              </Text>
              <Text as="span" variant="secondary" className="block">
                Open your trips like an app, one tap from your home screen.
              </Text>
            </div>
          </div>
          <div className="flex justify-end gap-2">
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
                dismissInstallNudge();
                install();
              }}
            >
              Install
            </Button>
          </div>
        </Card>
      )}
      {steps}
    </>
  );
}
