import { z } from "zod";
import { DayRef } from "@tc/contracts";

// Where an internal link goes, and what its card says (M30, ADR-056).
//
// **Ids, never a URL.** A stored link names a notebook by its page id, a day by
// its day id and a tab by its name, so renaming the notebook, moving the day or
// changing a route changes nothing stored. `apps/web` turns a target into an
// href at render time (`linkHref`), which is the one place the app's routes are
// known — this package decides what a link MEANS, not where the router keeps it.

/** The trip tabs a link may open. Overview is not one: it is a notebook, and links as one. */
export const LINK_VIEWS = ["Plan", "Calendar", "Map"] as const;
export type LinkView = (typeof LINK_VIEWS)[number];

export const LinkTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notebook"), pageId: z.string().uuid() }),
  // `DayRef`, the same reference every day filter stores. A picker writes the
  // `dayId` form so a link keeps pointing at its day when days are reordered.
  z.object({ kind: z.literal("day"), day: DayRef }),
  z.object({ kind: z.literal("view"), view: z.enum(LINK_VIEWS) }),
]);
export type LinkTarget = z.infer<typeof LinkTarget>;

/**
 * What an internal link card shows. Display-ready, like every block payload.
 *
 * `to` rides along for the renderer to build the href from; `openable` says
 * whether it may (`NotebookIndex.openable`). `eyebrow` is what KIND of place
 * this is — "Notebook", "Day 3", "Tab" — so a card reads as a signpost before
 * its title is read.
 */
export interface LinkCardPayload {
  kind: "link-card";
  to: LinkTarget;
  eyebrow: string;
  title: string;
  summary: string;
  openable: boolean;
}

/** A notebook's preview line, from its own words: at most this many characters. */
export const FIRST_LINE_MAX = 140;

/**
 * The first line of prose in a stored page document, and how many widgets it
 * holds — what a link card and the Notebook index say about a notebook without
 * carrying its document (ADR-056).
 *
 * The first heading or paragraph with any TEXT in it wins, and only its text
 * nodes count: a widget mid-sentence is left out rather than printed as its
 * stored name, which would be raw syntax on the screen. Tolerant by design —
 * this reads what is stored, including documents this build cannot parse, and
 * answers `null` rather than throwing.
 */
export function notebookPreviewOf(content: unknown): { firstLine: string | null; widgetCount: number } {
  let firstLine: string | null = null;
  let widgetCount = 0;
  const textOf = (node: unknown): string => {
    if (typeof node !== "object" || node === null) return "";
    const n = node as { type?: unknown; text?: unknown; content?: unknown };
    if (n.type === "text" && typeof n.text === "string") return n.text;
    if (n.type === "hardBreak") return " ";
    return Array.isArray(n.content) ? n.content.map(textOf).join("") : "";
  };
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const n = node as { type?: unknown; content?: unknown };
    if (n.type === "macro" || n.type === "repeat") widgetCount++;
    if (firstLine === null && (n.type === "paragraph" || n.type === "heading")) {
      const line = textOf(n).replace(/\s+/g, " ").trim();
      if (line !== "") firstLine = line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(content);
  return { firstLine, widgetCount };
}
