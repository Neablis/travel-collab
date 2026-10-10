"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TripSummary } from "@tc/contracts";
import { useSessionUser } from "@/components/account/useSessionUser";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchTrips } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { askCommand, placeCommands } from "./commands";
import { rankCommands } from "./match";
import { type PaletteCommand, usePaletteCommands } from "./paletteRegistry";

// **⌘K** (M41 D9, ADR-068): go anywhere or start anything without the mouse.
// Mounted once by `(app)/layout.tsx`, so it opens from every app page. What it
// lists is what the page below has registered (`usePaletteSource`), the
// assistant's opener where a screen offers one (the same entry the phone's
// tab bar Ask uses), and the app's places and your trips. It runs nothing of
// its own: every command is a page control's function.
//
// **Focus goes back where it was, and only then does the command run.** A
// command that opens something (the editor, Trip settings, the assistant)
// opens it once the palette has closed and handed focus back, so the thing
// it opens closes onto the control you were on rather than onto <body>
// (KI-2026-10-09-b).
//
// **No match goes nowhere** (ADR-068 §5): unmatched text is not handed to the
// assistant in v1.

/** Opens on ⌘K (Ctrl+K off a Mac) from anywhere in the app. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const router = useRouter();
  const signedIn = useSessionUser() != null;
  const registered = usePaletteCommands();
  const ask = usePhoneAsk();
  const [trips, setTrips] = useState<readonly TripSummary[]>([]);
  const listId = useId();

  const show = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (open) setOpen(false);
      else show();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, show]);

  // Your trips, read each time it opens: a list kept from the last opening
  // would offer a trip deleted since.
  useEffect(() => {
    if (!open || !signedIn) return;
    let live = true;
    void fetchTrips().then((result) => {
      if (live && result.ok) setTrips(result.value.filter((trip) => trip.status === "active"));
    });
    return () => {
      live = false;
    };
  }, [open, signedIn]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...registered,
      ...(ask === null || ask.open ? [] : [askCommand(ask.onOpen)]),
      ...(signedIn ? placeCommands((href) => router.push(href), trips) : placeCommands((href) => router.push(href), []).filter((c) => c.id === "go:playbooks")),
    ],
    [registered, ask, signedIn, trips, router],
  );
  const shown = rankCommands(commands, query);
  const optionId = (index: number) => `${listId}-${index}`;

  const run = (command: PaletteCommand | undefined) => {
    if (command === undefined) return;
    pending.current = command.run;
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Go to or do"
      onCloseAutoFocus={(event) => {
        const back = returnTo.current;
        if (back?.isConnected && back !== document.body) {
          event.preventDefault();
          back.focus();
        }
        const next = pending.current;
        pending.current = null;
        next?.();
      }}
    >
      <Input
        // Radix otherwise focuses the first control in the dialog, which is
        // its header's Close: the palette is for typing into at once.
        autoFocus
        role="combobox"
        aria-label="Go to or do"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Calendar, new stop, ask…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (shown.length === 0 ? 0 : (i + step + shown.length) % shown.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(shown[active]);
          }
        }}
      />
      <div id={listId} role="listbox" aria-label="Commands" className="mt-2 py-1 text-sm">
        {shown.length === 0 ? <p className="px-3 py-2 text-slate">No match</p> : null}
        {shown.map((command, index) => (
          <div
            key={command.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-3 py-2 text-ink md:py-1.5", index === active && "bg-brand-tint")}
            // `mousedown` would take focus from the box before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => run(command)}
          >
            <span className="truncate">{command.label}</span>
            <span className="shrink-0 text-xs text-slate">{command.group}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
