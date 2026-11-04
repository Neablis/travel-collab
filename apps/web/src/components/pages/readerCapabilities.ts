"use client";
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { WidgetContext } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";

/**
 * Marks a subtree as read by the public (M58, ADR-088 §4): a stranger on a
 * public notebook's link. `publicTokenFor` is the live-link lookup the server
 * hands in, by page id (`WidgetContext.publicTokenFor`).
 */
const PublicReaderContext = createContext<{ publicTokenFor: (pageId: string) => string | null } | null>(null);

export function PublicReaderProvider({ publicTokenFor, children }: { publicTokenFor: (pageId: string) => string | null; children: ReactNode }) {
  return createElement(PublicReaderContext.Provider, { value: { publicTokenFor } }, children);
}

/**
 * What this reader may do from a notebook beyond reading (M52 decision 20),
 * as `WidgetContext` carries it.
 *
 * Read from what the trip's screen offers (`usePhoneAsk`), not decided here: a
 * screen offers its chat only where the reader can see it (`hasChat` on the
 * board), and says a trip is solo only to its one traveler. A share link's
 * page offers neither, so it is false there with no check of its own.
 *
 * **The public reader is decided here, and has no chat whatever a screen
 * offers** (M58 floor, ADR-088 §5): a stranger holds no seat on the trip.
 */
export function useReaderCapabilities(): Pick<WidgetContext, "canChat" | "chat" | "soloTrip" | "reader" | "publicTokenFor"> {
  const entry = usePhoneAsk();
  const publicReader = useContext(PublicReaderContext);
  if (publicReader !== null) {
    return { reader: "public", canChat: false, chat: null, soloTrip: false, publicTokenFor: publicReader.publicTokenFor };
  }
  const soloTrip = entry?.soloTrip === true;
  return { canChat: entry?.chat !== undefined || soloTrip, chat: entry?.chat?.messages ?? null, soloTrip };
}
