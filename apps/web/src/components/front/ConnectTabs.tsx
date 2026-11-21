"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { tabId, tabPanelId, UnderlineTabs } from "@/components/ui/underline-tabs";

// The client tabs of `/developers`' "Connect your AI". A client component only
// because a tab keeps a selection; `DevelopersScreen` stays a server component
// and hands each panel in as children.
//
// **JavaScript off.** Every panel is in the server's HTML and none is hidden,
// so each client's steps are readable and the tab buttons are simply inert.
// Panels are hidden only once the page has hydrated (`useSyncExternalStore`'s
// server snapshot is `false`, so the first client render matches the HTML).
//
// **Hash.** The section inside each panel keeps its own anchor (`#connect-claude`
// and so on), linked from `/ai` and `/agents.md`. A hash naming one opens that
// tab on load and on every `hashchange`, then scrolls to it: the browser's own
// jump lands on a panel that was still hidden.

export interface ConnectClient<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly panel: React.ReactNode;
}

const HASH_PREFIX = "connect-";
const subscribe = () => () => {};

export function ConnectTabs<T extends string>({
  clients,
  idPrefix,
  "aria-label": ariaLabel,
}: {
  clients: readonly ConnectClient<T>[];
  idPrefix: string;
  "aria-label": string;
}) {
  const [selected, setSelected] = useState<T>(clients[0]!.value);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);

  useEffect(() => {
    function fromHash() {
      const id = window.location.hash.slice(1);
      const match = clients.find((c) => id === `${HASH_PREFIX}${c.value}`);
      if (match === undefined) return;
      setSelected(match.value);
      // After the new panel is shown: the section's own id is what the link names.
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.());
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [clients]);

  return (
    <div className="flex flex-col gap-4">
      <UnderlineTabs
        value={selected}
        onValueChange={setSelected}
        options={clients.map(({ value, label }) => ({ value, label }))}
        idPrefix={idPrefix}
        aria-label={ariaLabel}
        hasPanel
      />
      {clients.map((c) => (
        <div
          key={c.value}
          role="tabpanel"
          id={tabPanelId(idPrefix, c.value)}
          aria-labelledby={tabId(idPrefix, c.value)}
          hidden={hydrated && c.value !== selected}
          tabIndex={0}
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {c.panel}
        </div>
      ))}
    </div>
  );
}
