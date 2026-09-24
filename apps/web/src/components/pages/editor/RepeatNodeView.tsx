"use client";
import { Fragment, type ReactNode } from "react";
import { NodeViewContent, NodeViewWrapper, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import type { PageInlineNode, PageMark } from "@tc/contracts";
import { repeatLabel, resolveRepeat, type ItemScope, type RepeatOutcome, type WidgetContext } from "@tc/pages";
import { cn } from "@/lib/cn";
import { useToday } from "@/lib/today";
import { EmptyChip } from "../EmptyChip";
import { MacroView } from "../MacroView";
import { useMacroEditorContext, type MacroEditorContextValue } from "./MacroEditorContext";

// How an authored repeat reads (ADR-035 decision 4; the 2026-09-19
// design-parity section's dashed rail).
//
// **Editing** shows the template ONCE, editable in place, inside a dashed
// outline whose label names what it repeats over and how many — *"For every
// day · 9 days"* — in the brand accent when it resolves, neutral when it is
// empty or waiting on something. The widgets in the template preview the FIRST
// item (`templateItem`), so the author reads a real line while writing it.
// This is the design for catalogue row 12's *"Edit the wording"*: the wording
// is document content (the ADR), so editing it is clicking into it. No dialog,
// no second copy of the sentence, nothing to open or close.
//
// **Reading** renders the template once per item, each widget resolved in that
// item's scope, and the template itself is hidden. A repeat over nothing reads
// as its collection's `emptyText`; Editing keeps the rail and the template so
// there is something to write into (ADR-035, catalogue row 11).
//
// Outline and label are painted OUT of flow, as a widget's are (§26: the prose
// does not move when Editing opens) — see `.tc-widget-edit`.

/** The `ctx` every resolver takes, from what the editor's context carries. */
function widgetContext(value: MacroEditorContextValue, today: string | null): WidgetContext {
  return { trip: value.detail, page: value.context, user: value.user, globals: value.globals, today, external: value.external };
}

/**
 * The item a widget in a repeat's template previews while Editing: the
 * repeat's first, or `undefined` when the widget is not in a repeat or the
 * repeat has no items (the widget then reads unscoped, as anywhere else).
 *
 * Read from the document at render time rather than handed down: TipTap mounts
 * each node view in its own portal, so React context from the repeat's view
 * never reaches the widgets inside it.
 */
export function templateItem(
  editor: Editor,
  getPos: (() => number | undefined) | boolean,
  ctx: WidgetContext,
): ItemScope | undefined {
  if (typeof getPos !== "function") return undefined;
  let pos: number | undefined;
  try {
    pos = getPos();
  } catch {
    // A node view asked for its position mid-teardown; there is no parent to read.
    return undefined;
  }
  if (pos === undefined || pos > editor.state.doc.content.size) return undefined;
  const parent = editor.state.doc.resolve(pos).parent;
  if (parent.type.name !== "repeat") return undefined;
  const outcome = resolveRepeat(ctx, parent.attrs.name as string, parent.attrs.params);
  return outcome.status === "ok" ? outcome.items[0] : undefined;
}

// Marks as StarterKit writes them. Anything else prints as plain text: a mark
// is formatting, and dropping one is not losing the sentence.
function marked(text: string, marks: readonly PageMark[] | undefined): ReactNode {
  return (marks ?? []).reduce<ReactNode>((inner, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{inner}</strong>;
      case "italic":
        return <em>{inner}</em>;
      case "strike":
        return <s>{inner}</s>;
      case "code":
        return <code>{inner}</code>;
      default:
        return inner;
    }
  }, text);
}

/** One line of a repeat in Reading: the template, with every widget reading `item`. */
function TemplateLine({ nodes, item, value }: { nodes: readonly PageInlineNode[]; item: ItemScope; value: MacroEditorContextValue }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return <Fragment key={i}>{marked(node.text, node.marks)}</Fragment>;
          case "hardBreak":
            return <br key={i} />;
          case "macro":
            return (
              <span key={i} data-macro-name={node.attrs.name}>
                <MacroView
                  detail={value.detail}
                  context={value.context}
                  user={value.user}
                  globals={value.globals}
                  external={value.external}
                  name={node.attrs.name}
                  params={node.attrs.params}
                  item={item}
                />
              </span>
            );
          // A node from a newer build inside the template: nothing to print.
          // The template in Editing still carries it, untouched.
          default:
            return null;
        }
      })}
    </>
  );
}

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

/** Reading's answer when there is no line to print. */
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
 * Renders a `repeat` node: the rail and the editable template while Editing,
 * one line per item while Reading. The rendered lines are computed from the
 * template on every render and never written back — the items are not stored
 * (ADR-035 decision 4).
 */
export function RepeatNodeView({ node }: ReactNodeViewProps) {
  const value = useMacroEditorContext();
  const today = useToday();
  const outcome = resolveRepeat(widgetContext(value, today), node.attrs.name as string, node.attrs.params);
  const { editing } = value;
  const { label, resolved } = rail(outcome);
  const template = (node.content.toJSON() ?? []) as PageInlineNode[];
  const over = outcome.status === "invalid" ? undefined : outcome.over;

  return (
    <NodeViewWrapper
      as="div"
      data-repeat-over={over}
      className={cn("my-3", editing && "tc-widget-edit relative", editing && resolved && "outline-brand")}
    >
      {editing ? (
        <span
          contentEditable={false}
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
      {editing && template.length === 0 ? (
        <span contentEditable={false} className="pointer-events-none absolute top-0 left-0 max-w-full truncate text-slate select-none">
          Write the sentence for each {over ?? "item"}, and add widgets to it
        </span>
      ) : null}
      {/* The template. Hidden in Reading rather than removed: ProseMirror owns
          this element in both modes, and the lines below are what a reader
          sees instead. */}
      <NodeViewContent as="p" className="my-0" hidden={!editing} />
      {/* An unwritten sentence reads as nothing: N empty lines would be a gap
          the reader cannot explain, and the author sees the prompt above in
          Editing (M14 PART 3 review, finding 5). */}
      {editing || template.length === 0 ? null : outcome.status === "ok" ? (
        outcome.items.map((item, i) => (
          <p key={i} data-repeat-line className="my-1">
            <TemplateLine nodes={template} item={item} value={value} />
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
