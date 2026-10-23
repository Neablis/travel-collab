"use client";
import { useEffect, useState } from "react";
import type { ActivityMode, Location } from "@tc/contracts";
import { resolveLink, useBoardFocus } from "@/components/chat/boardFocus";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { directionsUrl } from "@/lib/directions";

// What the day-of widgets (M52 decision 15) share: a clock that moves each
// minute, a stop's name that focuses it on the board, and the Directions link.

/**
 * The time now, read again each minute and when the tab comes back into view,
 * so a countdown and *now and next* keep up while the page stays open.
 */
export function useMinuteClock(): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const read = () => setAt(Date.now());
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    const timer = window.setInterval(read, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return at;
}

/**
 * A stop's name, which focuses the stop on the board when there is one to go
 * to (`useBoardFocus`, as a chat chip does); plain text on a page with no
 * board, or while the page is being edited.
 */
export function StopName({ activityId, title, interactive }: { activityId: string; title: string; interactive: boolean }) {
  const board = useBoardFocus();
  const link = interactive ? resolveLink(board, { kind: "stop", id: activityId }) : null;
  if (link === null) return <span className="font-medium text-ink">{title}</span>;
  return (
    <Button variant="ghost" size="sm" onClick={link.focus} className="h-auto self-start px-0 text-left text-base text-ink hover:bg-transparent hover:underline">
      {title}
    </Button>
  );
}

/** Directions to `place` in Google Maps, in a new tab: Maps gets neither this window nor the trip's URL. */
export function DirectionsLink({ place, mode, label }: { place: Location; mode: ActivityMode | null; label: string }) {
  return (
    <a
      href={directionsUrl(place, mode)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0 self-start")}
    >
      Directions
    </a>
  );
}
