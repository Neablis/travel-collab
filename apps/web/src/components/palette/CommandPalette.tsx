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
import { type PaletteNode, paletteLevel, pathText } from "./grammar";
import { searchPalette } from "./match";
import { type PaletteCommand, usePaletteCommands } from "./paletteRegistry";

// **⌘K** (M41 D9, ADR-068): go anywhere or start anything without the mouse.
// Mounted once by `(app)/layout.tsx`, so it opens from every app page. What it
// lists is what the page below has registered (`usePaletteSource`), the
// assistant's opener where a screen offers one (the same entry the phone's
// tab bar Ask uses), and the app's places and your trips. It runs nothing of
// its own: every command is a page control's function.
//
// **It speaks ADR-069's grammar.** Empty, it lists the actions; Enter or Tab
// on one drills in, a chip shows the path, and Backspace in an empty box
// climbs back out. Typing searches every leaf under where you are, so
// nobody has to drill to get anywhere.
//
// **Focus goes back where it was, and only then does the command run.** A
// command that opens something (the editor, Trip settings, the assistant)
// opens it once the palette has closed and handed focus back, so the thing
// it opens closes onto the control you were on rather than onto <body>
// (KI-2026-10-09-b).
//
// **No match goes nowhere** (ADR-068 §5): unmatched text is not handed to the
// assistant in v1.

// On a Mac, Ctrl+K is a text field's kill-line, so ⌘K alone opens it there
// (PR 398 review). `userAgentData` where the browser has it, else the
// long-deprecated but everywhere-present `platform`.
function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

// K as typed, or, on a layout whose letters are not Latin (Cyrillic's "л"),
// the key where K is: a Dvorak K is still K by what it types.
function isK(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  return key === "k" || (!/^[a-z]$/.test(key) && event.code === "KeyK");
}

/**
 * A row of the list: a level's node, or a typed query's leaf under its
 * action's heading, which `spoken` says again for a reader of the row alone.
 */
type Row = { id: string; heading?: string; spoken?: string; node: PaletteNode };

/** Opens on ⌘K (Ctrl+K off a Mac) from anywhere in the app. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The branches drilled into, outermost first.
  const [trail, setTrail] = useState<readonly { key: string; label: string }[]>([]);
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
    setTrail([]);
    // Not the last opening's list, which may hold a trip deleted since and
    // would stay if this opening's read fails.
    setTrips([]);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mac = isMac();
      if (!isK(event) || !(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey) return;
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
  // As deep as the trail still leads: a branch can empty while it is open
  // (the focused day's commands go when focus does), and the palette then
  // stands at the nearest level that is still there.
  let depth = trail.length;
  let level = paletteLevel(commands, trail.slice(0, depth).map((step) => step.key));
  while (level === null) {
    depth -= 1;
    level = paletteLevel(commands, trail.slice(0, depth).map((step) => step.key));
  }
  const path = trail.slice(0, depth);
  const at = path.map((step) => step.key);
  const rows: Row[] =
    query.trim() === ""
      ? level.map((node) => ({ id: node.key, node }))
      : searchPalette(commands, query, at).flatMap((group) =>
          group.commands.map((command): Row => {
            // Drilled in, every row shares the chip's action. A singleton is
            // its own action: no heading over one row of itself.
            const grouped = at.length === 0 && command.type !== undefined;
            return {
              id: command.id,
              heading: grouped ? group.action : undefined,
              spoken: grouped ? `${group.action} › ` : undefined,
              node: { kind: "leaf", key: command.id, label: pathText(command, grouped ? 1 : at.length), command },
            };
          }),
        );
  // Held inside the list, which can shrink under it while it is open (a
  // screen's commands change, the trips arrive): past its end, Enter would
  // run nothing and the box would name an option that is not there.
  const current = Math.min(active, Math.max(rows.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  const choose = (row: Row | undefined) => {
    if (row === undefined) return;
    if (row.node.kind === "branch") {
      setTrail([...path, { key: row.node.key, label: row.node.label }]);
      setQuery("");
      setActive(0);
      return;
    }
    pending.current = row.node.command.run;
    setOpen(false);
  };

  const option = (row: Row, index: number) => (
    <div
      key={row.id}
      id={optionId(index)}
      role="option"
      aria-selected={index === current}
      className={cn("flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-3 py-2 text-ink md:py-1.5", index === current && "bg-brand-tint")}
      // `mousedown` would take focus from the box before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setActive(index)}
      onClick={() => choose(row)}
    >
      <span className="truncate">
        {row.spoken !== undefined ? <span className="sr-only">{row.spoken}</span> : null}
        {row.node.label}
      </span>
      {row.node.kind === "branch" ? (
        <span aria-hidden className="shrink-0 text-xs text-slate">
          ›
        </span>
      ) : null}
    </div>
  );

  // Consecutive rows under one heading, as the listbox's groups.
  const sections: { heading?: string; rows: { row: Row; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = sections.at(-1);
    if (last !== undefined && row.heading !== undefined && last.heading === row.heading) last.rows.push({ row, index });
    else sections.push({ heading: row.heading, rows: [{ row, index }] });
  });

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
      {/* What a screen tracking focus reads as "still where it was" while
          the palette is open (CalendarLens's city cards). */}
      <div data-command-palette>
        <div className="flex items-center gap-2">
          {path.length > 0 ? (
            <span data-testid="palette-path" className="shrink-0 rounded-sm bg-brand-tint px-2 py-1 text-sm text-ink">
              {path.map((step) => step.label).join(" › ")} ›
            </span>
          ) : null}
          <Input
            // Radix otherwise focuses the first control in the dialog, which is
            // its header's Close: the palette is for typing into at once.
            autoFocus
            role="combobox"
            aria-label="Go to or do"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length > 0 ? optionId(current) : undefined}
            autoComplete="off"
            placeholder={path.length > 0 ? "Type to narrow…" : "Calendar, new stop, ask…"}
            // A `w-full` flex item takes a 100% basis (KI-2026-09-14-c): beside the chip it must shrink.
            className="min-w-0 flex-1"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              // An IME's Enter picks its candidate; it is not this list's Enter.
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive(rows.length === 0 ? 0 : (current + step + rows.length) % rows.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(rows[current]);
              } else if (event.key === "Tab" && !event.shiftKey && rows[current]?.node.kind === "branch") {
                // Only on a branch: anywhere else Tab still leaves the box.
                event.preventDefault();
                choose(rows[current]);
              } else if (event.key === "Backspace" && query === "" && path.length > 0) {
                event.preventDefault();
                setTrail(path.slice(0, -1));
                setActive(0);
              }
            }}
          />
        </div>
        <div id={listId} role="listbox" aria-label={path.length > 0 ? path.map((step) => step.label).join(" › ") : "Commands"} className="mt-2 py-1 text-sm">
          {rows.length === 0 ? <p className="px-3 py-2 text-slate">No match</p> : null}
          {sections.map((section) =>
            section.heading === undefined ? (
              section.rows.map(({ row, index }) => option(row, index))
            ) : (
              <div key={`group:${section.heading}`} role="group" aria-labelledby={`${listId}-group-${section.heading}`}>
                <div id={`${listId}-group-${section.heading}`} role="presentation" className="px-3 pt-2 pb-1 text-xs text-slate">
                  {section.heading}
                </div>
                {section.rows.map(({ row, index }) => option(row, index))}
              </div>
            ),
          )}
        </div>
      </div>
    </Dialog>
  );
}
