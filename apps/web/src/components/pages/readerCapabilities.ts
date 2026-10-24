"use client";
import type { WidgetContext } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";

/**
 * What this reader may do from a notebook beyond reading (M52 decision 20),
 * as `WidgetContext` carries it.
 *
 * Read from what the trip's screen offers (`usePhoneAsk`), not decided here: a
 * screen offers its chat only where the reader can see it (`hasChat` on the
 * board), and says a trip is solo only to its one traveler. A share link's
 * page offers neither, so it is false there with no check of its own.
 */
export function useReaderCapabilities(): Pick<WidgetContext, "canChat" | "chat" | "soloTrip"> {
  const entry = usePhoneAsk();
  const soloTrip = entry?.soloTrip === true;
  return { canChat: entry?.chat !== undefined || soloTrip, chat: entry?.chat?.messages ?? null, soloTrip };
}
