"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";

// The control for a `field` input (M14 field widget, build step 5): a search
// box over the manifest's published fields, grouped, showing labels and
// storing paths. ADR-037 open question 4 as Mitchell put it — *"always avoid
// dropping into letting end user write raw string templates … a search input,
// a dropdown, something easy for them to use"* — so the path is the option's
// value and never its text, and typing only filters; it never becomes the
// stored value.
//
// Not a `<select>`, unlike every other bind control (ADR-010 keeps those
// native): a root publishes more fields than a select reads down comfortably,
// and grows with each annotation. It is the WAI-ARIA combobox-with-listbox
// pattern, hand-rolled because the app has no combobox dependency and this is
// its only one.

export interface FieldOption {
  value: string;
  label: string;
  /** The heading it lists under. A stale stored path has none. */
  group?: string;
}

// Every word must match the label or the group, the rule the widget picker's
// own search follows (`presets.ts` keywords), so "day date" finds the day's date.
function matches(option: FieldOption, query: string): boolean {
  const haystack = `${option.label} ${option.group ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

// The list's tallest (`max-h-64`), and the gap it keeps from the screen's edge.
const LIST_MAX_PX = 256;
const EDGE_PX = 8;

/**
 * Where the open list goes: below the box when a full list fits there, else on
 * whichever side has more room, capped to that room. On a phone the last
 * picker in the insert sheet's bind step sits near the bottom of the screen,
 * and a list that always opened downward ran 44% of itself off it (measured,
 * PR #222's CI) — reachable by nobody. Pure, so the rule is testable without
 * a layout engine.
 */
export function listPlacement(box: { top: number; bottom: number }, viewportHeight: number) {
  const below = viewportHeight - box.bottom - EDGE_PX;
  const above = box.top - EDGE_PX;
  if (below >= LIST_MAX_PX || below >= above) return { side: "below" as const, maxHeight: Math.min(LIST_MAX_PX, Math.max(below, 0)) };
  return { side: "above" as const, maxHeight: Math.min(LIST_MAX_PX, above) };
}

/**
 * The band of the screen `el`'s list can actually be seen in: the viewport,
 * cut down by every ancestor that clips its overflow. The phone's insert sheet
 * scrolls its body inside padding, so a list measured against the viewport
 * alone could fit the screen and still lose its last pixels under the sheet's
 * edge — measured on "A line for every booking"'s bind step, 2px past a body
 * ending 20px above the screen's bottom.
 */
function visibleRoom(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.visualViewport?.height ?? window.innerHeight;
  for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "" || overflow === "visible") continue;
    const rect = parent.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

/**
 * A search box that picks one field: shows `label`s under their `group`,
 * hands `onChange` the chosen option's `value` (the stored path), and never
 * stores what was typed.
 */
export function FieldPicker({
  id,
  label,
  options,
  value,
  onChange,
  layout,
}: {
  id: string;
  /** The accessible name, when no visible label names the box. */
  label?: string;
  options: readonly FieldOption[];
  value: string;
  onChange: (next: string) => void;
  layout: "inline" | "stacked";
}) {
  const listId = useId();
  // `null` while closed. Open, it is what the person has typed so far.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const open = query !== null;
  const shown = open ? options.filter((o) => matches(o, query)) : [];
  const current = options.find((o) => o.value === value)?.label ?? "";

  const close = () => {
    setQuery(null);
    setActive(0);
  };
  const pick = (option: FieldOption | undefined) => {
    if (option) onChange(option.value);
    close();
  };

  // Grouped in first-seen order, which is the manifest's declaration order.
  const groups: { name: string; options: { option: FieldOption; index: number }[] }[] = [];
  shown.forEach((option, index) => {
    const name = option.group ?? "";
    const group = groups.find((g) => g.name === name) ?? groups[groups.push({ name, options: [] }) - 1]!;
    group.options.push({ option, index });
  });
  const optionId = (index: number) => `${listId}-o${index}`;

  // Measured when the list opens, not while it is open: a list that moved
  // under the finger as the person typed would be worse than one that stays
  // where it first appeared.
  const boxRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof listPlacement>>({ side: "below", maxHeight: LIST_MAX_PX });
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const room = visibleRoom(boxRef.current);
    const box = boxRef.current.getBoundingClientRect();
    setPlacement(listPlacement({ top: box.top - room.top, bottom: box.bottom - room.top }, room.bottom - room.top));
  }, [open]);

  return (
    <div ref={boxRef} className={cn("relative", layout === "inline" ? "inline-block w-48" : "w-full")}>
      <Input
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown.length > 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Search fields"
        className={layout === "inline" ? "h-7 min-h-0 py-0 text-xs" : "min-h-11"}
        value={open ? query : current}
        onFocus={() => setQuery("")}
        // Focus alone misses the box that kept focus through an Escape or a pick.
        onClick={() => {
          if (!open) setQuery("");
        }}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setQuery("");
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (shown.length === 0 ? 0 : (i + step + shown.length) % shown.length));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
          }
        }}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label ?? "Fields"}
          className={cn(
            "absolute left-0 right-0 z-20 overflow-y-auto rounded-sm border border-border-input bg-surface py-1 text-sm shadow-overlay",
            placement.side === "below" ? "top-full mt-1" : "bottom-full mb-1",
          )}
          // eslint-disable-next-line no-restricted-syntax -- the cap is the room measured on the screen when the list opens; no token can say it.
          style={{ maxHeight: placement.maxHeight }}
          data-side={placement.side}
        >
          {shown.length === 0 ? <p className="px-3 py-2 text-slate">No field matches</p> : null}
          {groups.map((group, g) => (
            <div key={group.name} role="group" aria-labelledby={group.name ? `${listId}-g${g}` : undefined}>
              {group.name ? (
                <p id={`${listId}-g${g}`} className="px-3 pb-1 pt-2 font-mono text-xs uppercase text-slate">
                  {group.name}
                </p>
              ) : null}
              {group.options.map(({ option, index }) => (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  className={cn(
                    "cursor-pointer px-3 py-2 text-ink md:py-1.5",
                    index === active && "bg-brand-tint",
                    option.value === value && "font-semibold",
                  )}
                  // `mousedown` would blur the box and close the list before
                  // the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(option)}
                >
                  {option.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
