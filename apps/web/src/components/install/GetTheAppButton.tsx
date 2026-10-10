"use client";

import { MonitorDown } from "lucide-react";
import { Button, PHONE_TOUCH } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useInstallApp } from "./InstallApp";

/**
 * *Get the app* — the desktop's way to install, in the top nav beside
 * Playbooks (Mitchell, 2026-10-10 preview: "Maybe along the top on desktop
 * next to 'Playbooks' and make it more clear its a app?"). It replaced the
 * account menu's *Install app* row above 768px; a phone keeps that row, and
 * gets a card on Home (`InstallNudge`).
 *
 * Only where installing would work — the same `useInstallApp` the menu row
 * and the card use — so a browser that cannot install, or the installed app
 * itself, is never offered a control that does nothing. The icon is a screen
 * with a download arrow, so it reads as "install an app" rather than as one
 * more page. Styled as the nav's links are, so it sits in their row as a
 * peer; the caller's nav decides the breakpoint.
 */
export function GetTheAppButton() {
  const { route, install, steps } = useInstallApp();
  if (route === null) return null;
  return (
    <>
      <Button
        variant="ghost"
        onClick={install}
        className={cn(PHONE_TOUCH, "h-auto gap-1.5 rounded-sm px-2.5 py-1.5 text-base font-medium text-slate hover:bg-transparent hover:text-ink")}
      >
        <MonitorDown className="size-4" aria-hidden />
        Get the app
      </Button>
      {steps}
    </>
  );
}
