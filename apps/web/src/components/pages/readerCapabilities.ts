"use client";
import type { WidgetContext } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";

/**
 * What this reader may do from a notebook beyond reading (M52 decision 20),
 * as `WidgetContext` carries it.
 *
 * Read from what the trip's screen offers (`usePhoneAsk`), not decided here: a
 * screen offers its chat only where the reader can see it (`hasChat` on the
 * board). A share link's page offers none, so it is false there with no check
 * of its own.
 */
export function useReaderCapabilities(): Pick<WidgetContext, "canChat" | "chat"> {
  const chat = usePhoneAsk()?.chat;
  return { canChat: chat !== undefined, chat: chat?.messages ?? null };
}
