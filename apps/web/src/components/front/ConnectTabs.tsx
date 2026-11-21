"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { tabId, tabPanelId, UnderlineTabs } from "@/components/ui/underline-tabs";

// The client tabs of `/developers`' "Connect your AI". A client component only
// because a tab keeps a selection; `DevelopersScreen` stays a server component
// and hands each panel in as children.
//
// **JavaScript off.** The server HTML carries every panel's text, the
// non-default ones hidden, so a JS visitor never sees them flash and
// collapse. A `<noscript><style>` shows them again for a reader without
// JavaScript, whose tab buttons are inert.
//
// **Hash.** The section inside each panel keeps its own anchor (`#connect-claude`
// and so on), linked from `/ai` and `/agents.md`. A hash naming one, on load, on
// `hashchange` or on a click on a link to it, opens that tab and then scrolls to
// the section from an effect, which runs after React has committed the panel
// un-hidden. (A `requestAnimationFrame` could fire first and scroll to nothing.)
// The click is handled too because a link to the hash already in the URL fires
// no `hashchange`.

export interface ConnectClient<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly panel: React.ReactNode;
}

const HASH_PREFIX = "connect-";
// Un-hides the panels the server rendered hidden, for a reader with no JavaScript.
// Hidden by the `hidden` class, not the attribute: Tailwind's preflight hides
// `[hidden]` with a layered `!important`, which an unlayered rule cannot beat.
const NO_SCRIPT_CSS = "[data-connect-panel]{display:block!important}";

/**
 * Renders one client's "Connect your AI" panel at a time under underline tabs, and
 * opens the tab a `#connect-<client>` hash names. It keeps the selection in client
 * state so `DevelopersScreen` can stay a server component, and every panel's text
 * is in the server HTML so a reader without JavaScript still gets all of them.
 */
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
  // A fresh object per request, so asking for the tab already open still scrolls.
  const [scrollTo, setScrollTo] = useState<{ id: string } | null>(null);

  useEffect(() => {
    function open(id: string) {
      const match = clients.find((c) => id === `${HASH_PREFIX}${c.value}`);
      if (match === undefined) return;
      setSelected(match.value);
      setScrollTo({ id });
    }
    const fromHash = () => open(window.location.hash.slice(1));
    function onClick(event: MouseEvent) {
      const href = (event.target as Element | null)?.closest?.("a[href^='#']")?.getAttribute("href");
      if (href != null) open(href.slice(1));
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      document.removeEventListener("click", onClick);
    };
  }, [clients]);

  useEffect(() => {
    if (scrollTo !== null) document.getElementById(scrollTo.id)?.scrollIntoView?.();
  }, [scrollTo]);

  return (
    <div className="flex flex-col gap-4">
      <noscript>
        <style>{NO_SCRIPT_CSS}</style>
      </noscript>
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
          data-connect-panel=""
          tabIndex={0}
          className={cn(
            "rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            c.value !== selected && "hidden",
          )}
        >
          {c.panel}
        </div>
      ))}
    </div>
  );
}
