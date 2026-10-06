"use client";

import { useRouter } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import { CONSOLE_TABS, consoleTabHref, type ConsoleTab } from "./consoleTab";

// **A tab click is a navigation, not a client fetch** (M36 D1). The page is a
// server component that reads the Entitlements module directly, so the tab has
// to reach it as a request; `TabStrip` owns no state here, the URL does.

/** The console's Financial · Users · Library strip; a pick navigates to `/admin?tab=…`. */
export function ConsoleTabs({ value }: { value: ConsoleTab }) {
  const router = useRouter();
  return (
    <TabStrip
      value={value}
      onValueChange={(next) => router.push(consoleTabHref(next))}
      options={CONSOLE_TABS}
      aria-label="Console sections"
    />
  );
}
