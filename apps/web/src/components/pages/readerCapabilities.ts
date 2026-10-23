"use client";
import type { WidgetContext } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { AI_ASK_ENTITLEMENT, useEntitled } from "@/lib/useAiEntitled";

/**
 * What this reader may do from a notebook beyond reading (M52 decision 20),
 * as `WidgetContext` carries it.
 *
 * Read from what the trip's screen offers (`usePhoneAsk`), not decided here: a
 * screen offers its chat only where the reader can see it (`hasChat` on the
 * board), and Ask only where it has an assistant to open. A share link's page
 * offers neither, so every capability is false there with no check of its own.
 * Ask also needs the plan to include the assistant, asked the way the rail
 * asks (`useAiEntitled`, `null` counting as entitled), and only where a screen
 * offers one, so a page with none spends no request on the plan.
 */
export function useReaderCapabilities(): Pick<WidgetContext, "canChat" | "canAsk" | "chat"> {
  const entry = usePhoneAsk();
  const offersAsk = entry?.onAsk !== undefined;
  const entitled = useEntitled(AI_ASK_ENTITLEMENT, offersAsk);
  return {
    canChat: entry?.chat !== undefined,
    canAsk: offersAsk && entitled !== false,
    chat: entry?.chat?.messages ?? null,
  };
}
