"use client";
import { Button } from "@/components/ui/button";
import { FieldPicker, type FieldOption } from "./FieldPicker";

/**
 * The control for a `multiple` field input — `stop.rows`' `columns` (M14 field
 * widget, build step 6): one `FieldPicker` per chosen column, in order, each
 * with move and remove buttons, and one empty picker below that appends.
 *
 * Adding is a pick rather than a button that inserts a blank row, so the
 * stored list never holds an unchosen column. `onChange` receives the whole
 * new list; `[]` is the caller's to turn into an absent key.
 */
export function FieldColumns({
  id,
  name,
  value,
  optionsOf,
  onChange,
  layout,
}: {
  id: string;
  /** The accessible name of one part of the control ("column 2", "add a column"). */
  name: (part: string) => string;
  value: readonly string[];
  /** The options for a picker holding `path` — a stale path keeps its own row. */
  optionsOf: (path: string) => readonly FieldOption[];
  onChange: (next: string[]) => void;
  layout: "inline" | "stacked";
}) {
  const move = (from: number, to: number) => {
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {value.map((path, i) => {
        const n = i + 1;
        return (
          // Keyed by position, not path: a list may name one field twice, and
          // a picker keyed by its value would remount mid-edit.
          <div key={i} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <FieldPicker
                id={`${id}-${i}`}
                label={name(`column ${n}`)}
                options={optionsOf(path)}
                value={path}
                onChange={(next) => onChange(value.map((p, j) => (j === i ? next : p)))}
                layout={layout}
              />
            </div>
            <Button variant="ghost" size="icon" aria-label={name(`move column ${n} up`)} disabled={i === 0} onClick={() => move(i, i - 1)}>
              ↑
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={name(`move column ${n} down`)}
              disabled={i === value.length - 1}
              onClick={() => move(i, i + 1)}
            >
              ↓
            </Button>
            <Button variant="ghost" size="icon" aria-label={name(`remove column ${n}`)} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              ×
            </Button>
          </div>
        );
      })}
      {/* `id` itself, so a visible form label ("Columns") lands on the box
          that grows the list. */}
      <FieldPicker
        id={id}
        label={name("add a column")}
        options={optionsOf("")}
        value=""
        onChange={(next) => onChange([...value, next])}
        layout={layout}
      />
    </div>
  );
}
