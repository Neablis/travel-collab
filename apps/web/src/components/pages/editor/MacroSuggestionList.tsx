"use client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "../../ui/button";
import type { MacroCatalogItem } from "./useMacroSuggestion";

export interface MacroSuggestionListProps {
  items: MacroCatalogItem[];
  command: (item: MacroCatalogItem) => void;
}

export interface MacroSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// The `{{` autocomplete popup's content — a floating list of matching macro
// catalog entries (name + description), keyboard-navigable via the imperative
// `onKeyDown` handle that `useMacroSuggestion`'s `render()` wires into
// `SuggestionKeyDownProps`. Rendered into a tippy instance via `ReactRenderer`
// (see `useMacroSuggestion.ts`), so this component owns only the list UI —
// positioning/mounting is the tippy instance's job.
export const MacroSuggestionList = forwardRef<MacroSuggestionListRef, MacroSuggestionListProps>(
  function MacroSuggestionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          setSelectedIndex((index) => (index + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((index) => (index + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="z-50 min-w-56 rounded-lg border border-hairline bg-surface p-2 text-sm text-slate shadow-overlay">
          no matching macros
        </div>
      );
    }

    return (
      <div
        role="listbox"
        className="z-50 max-h-72 min-w-64 overflow-y-auto rounded-lg border border-hairline bg-surface p-1 shadow-overlay"
      >
        {items.map((item, index) => (
          <Button
            key={item.name}
            role="option"
            aria-selected={index === selectedIndex}
            variant="ghost"
            size="md"
            className={cn(
              "h-auto w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left font-normal",
              index === selectedIndex && "bg-moss",
            )}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="text-sm font-medium text-ink">{item.name}</span>
            <span className="text-xs text-slate">{item.description}</span>
          </Button>
        ))}
      </div>
    );
  },
);
