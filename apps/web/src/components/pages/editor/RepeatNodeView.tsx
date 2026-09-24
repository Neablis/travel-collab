"use client";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { repeatLabel, repeatNoun, repeatTemplate, resolveRepeat, sentenceLines, type RepeatOutcome } from "@tc/pages";
import { cn } from "@/lib/cn";
import { useToday } from "@/lib/today";
import { EmptyChip } from "../EmptyChip";
import { SELECTED_RING } from "./MacroNodeView";
import { useMacroEditorContext } from "./MacroEditorContext";
import { useSelectionReport } from "./useSelectionReport";

// How an authored repeat reads (ADR-035 decision 4; the 2026-09-19
// design-parity section's dashed rail).
//
// **Both modes print the same lines.** Mitchell, on the PR #221 preview: *"every
// widget should be shown as it will render in the notebook in edit mode so we
// dont have issues going back and forth between editing/done just to see how it
// will flow"*. So the sentence is resolved against the real trip in Editing
// too, one line per item; what Editing adds is only what every widget gets — a
// dashed outline, a rail label naming what it repeats over and how many
// (*"For every day · 9 days"*, accented when it resolves), a selection ring,
// and the click that opens its settings. The raw sentence, braces and all, is
// in the settings panel's text field and nowhere on the page.
//
// A sentence not written yet reads as nothing in Reading — N empty lines would
// be a gap the reader cannot explain (M14 PART 3 review, finding 5) — and as a
// prompt in Editing, so there is something to click.
//
// Outline and label are painted OUT of flow, as a widget's are (§26: the prose
// does not move when Editing opens) — see `.tc-widget-edit`.

/** What the rail says, and whether it wears the accent (only when it resolves). */
function rail(outcome: RepeatOutcome): { label: string; resolved: boolean } {
  switch (outcome.status) {
    case "ok":
      return { label: repeatLabel(outcome.over, outcome.items.length), resolved: true };
    case "empty":
      return { label: repeatLabel(outcome.over, 0), resolved: false };
    case "unbound":
      return { label: repeatLabel(outcome.over, null), resolved: false };
    case "invalid":
      return { label: "A sentence that no longer repeats", resolved: false };
  }
}

/** The answer when there is no line to print, the same in both modes. */
function Unrepeated({ outcome, onBindDay }: { outcome: Exclude<RepeatOutcome, { status: "ok" }>; onBindDay?: () => void }) {
  switch (outcome.status) {
    case "empty":
      return <EmptyChip tone="muted" label={outcome.emptyText} />;
    case "invalid":
      return <EmptyChip tone="error" label="this sentence's settings no longer fit it" />;
    case "unbound":
      if (outcome.needs === "day") {
        return <EmptyChip tone={onBindDay ? "action" : "muted"} label="that day was removed" onClick={onBindDay} />;
      }
      return <EmptyChip tone="muted" label={outcome.needs === "trip" ? "needs a trip" : "not set up yet"} />;
  }
}

/**
 * Renders a `repeat` node: one line per item, in both modes. The lines are
 * computed from the template on every render and never written back — the
 * items are not stored (ADR-035 decision 4) — and each reaches the page as a
 * React text node, never as markup.
 */
export function RepeatNodeView({ node, selected, editor }: ReactNodeViewProps) {
  const value = useMacroEditorContext();
  const today = useToday();
  const name = node.attrs.name as string;
  const params = useSelectionReport(selected, name, node.attrs.params, editor);
  const ctx = { trip: value.detail, page: value.context, user: value.user, globals: value.globals, today, external: value.external };
  const outcome = resolveRepeat(ctx, name, params);
  const { editing } = value;
  const { label, resolved } = rail(outcome);
  const template = repeatTemplate(params);
  const over = outcome.status === "invalid" ? undefined : outcome.over;

  return (
    <NodeViewWrapper
      as="div"
      data-repeat-over={over}
      className={cn(
        "my-3",
        editing && "tc-widget-edit relative",
        editing && resolved && "outline-brand",
        editing && selected && SELECTED_RING,
      )}
    >
      {editing ? (
        <span
          data-testid="repeat-rail"
          data-resolved={resolved}
          className={cn(
            "absolute -top-3.5 left-0 text-2xs leading-none font-semibold select-none",
            resolved ? "text-brand-pressed" : "text-slate",
          )}
        >
          {label}
        </span>
      ) : null}
      {template === "" ? (
        editing ? (
          <p className="my-1 text-slate select-none">
            Write the sentence for each {over === undefined ? "item" : repeatNoun(over)} in this widget&apos;s settings
          </p>
        ) : null
      ) : outcome.status === "ok" ? (
        sentenceLines(ctx, outcome.over, outcome.items, template).map((line, i) => (
          <p key={i} data-repeat-line className="my-1">
            {line}
          </p>
        ))
      ) : (
        <p className="my-1">
          <Unrepeated outcome={outcome} onBindDay={value.onBindDay} />
        </p>
      )}
    </NodeViewWrapper>
  );
}
