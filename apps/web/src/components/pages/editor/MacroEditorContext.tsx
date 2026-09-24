"use client";
import { createContext, useContext } from "react";
import type { Editor } from "@tiptap/react";
import type { TripDetail, PageContext, TripGlobals, UserPreferences } from "@tc/contracts";
import type { ExternalInputs } from "@tc/pages";

// Carries the `detail`/`context` that every `macro` NodeView needs to resolve
// itself, from `PageEditor` down to `MacroNodeView` — without threading them
// through TipTap's per-extension `storage` (which isn't reactive: updating it
// doesn't re-render mounted React node views, so a live `detail` refresh
// would go stale inside the editor until the next keystroke touched the
// node). A React context re-renders every subscriber whenever `detail`
// changes, matching how any other read-side data flows into this app.
export interface MacroEditorContextValue {
  detail: TripDetail;
  context: PageContext;
  // The account, which every notebook is in scope of (ADR-037 open question 2).
  // `null` means the preferences request has not landed or failed — the page
  // still opens, and account widgets render "not set up" (decision 6) rather
  // than the notebook refusing to load over a preference fetch.
  user: UserPreferences | null;
  // The trip's addressable collections; `null` until the request lands.
  globals: TripGlobals | null;
  // Outside data (ADR-052) — every slot pending until `useExternalInputs`
  // hears back, and never fetched for a page with no widget that needs it.
  external?: ExternalInputs;
  // Reading vs Editing (§18: one control, two states). Reading is the
  // traveller's view and shows no chrome, so the chrome row reads this rather
  // than each widget guessing.
  editing: boolean;
  onBindDay?: () => void;
  /**
   * SPEC §26: a widget reports when it becomes the selected one, so the
   * SURFACE — not the document — can show its settings.
   *
   * > The document reads identically in both modes. No widget control is ever
   * > in the document flow.
   *
   * The callback carries the EDITOR, because the panel is about the selected
   * widget's whole block — every widget in the sentence gets its own entry
   * (§26, `blockWidgets.ts`) — and only the editor can address the others.
   * Every write is still a transaction on this document: one update,
   * `onUpdate`, autosave, no second save path.
   *
   * **The reporter always names itself, including when it is clearing.** Every
   * mounted node view runs the same effect, so a click moving the selection
   * from A to B fires A's "I lost it" and B's "I have it" in an order React
   * decides. A bare `null` would let A's clear land after B's set and close the
   * panel that had just opened. With the key, a clear can be ignored unless it
   * comes from the widget currently being shown.
   *
   * Optional because `PageEditor` is mounted read-only by surfaces with no side
   * channel at all (the Overview tab, §25), and a settings panel there would be
   * a control on a document that cannot be edited.
   */
  onWidgetSelected?: (selection: SelectedWidget | null, reporterKey: string) => void;
}

/** The widget whose settings the surface's side channel is showing (SPEC §26). */
export interface SelectedWidget {
  /** Stable for the life of one mounted node view; identifies WHICH widget reported. */
  key: string;
  name: string;
  params: Record<string, unknown>;
  /** The editor the widget lives in; the panel reads the block and writes through it. */
  editor: Editor;
}

/**
 * Which of one commit's selection reports wins.
 *
 * **A claim beats a release.** Every mounted node view reports independently,
 * so moving the selection from A to B produces both "A lost it" and "B has it"
 * in one commit — in DOCUMENT order, which has nothing to do with what the user
 * clicked. Taking the last report therefore closed the panel whenever the newly
 * clicked widget sat higher up the page than the open one. Mitchell, on the
 * preview: *"opening edit ui is inconsistent, not sure why it sometimes works
 * and sometimes doesnt"*; the thing that decided was which widget came first.
 *
 * Not key matching, which a node view's remount on every rebind defeats (see
 * `PageScreen`). The asymmetry is the rule: the only way to get a claim and a
 * release in one commit is a selection MOVING, and the claim is where it moved
 * to. Every report being null is the one state that means nothing is selected —
 * a click into the prose, or the selected widget being deleted.
 *
 * Pure and exported so it can be argued with directly: the surrounding flush is
 * a microtask inside a screen, which is not where a rule like this should only
 * be readable.
 */
export function winningReport(reports: readonly (SelectedWidget | null)[]): SelectedWidget | null {
  return reports.reduce<SelectedWidget | null>((won, report) => report ?? won, null);
}

export const MacroEditorContext = createContext<MacroEditorContextValue | null>(null);

export function useMacroEditorContext(): MacroEditorContextValue {
  const value = useContext(MacroEditorContext);
  if (!value) {
    throw new Error("useMacroEditorContext must be used within a MacroEditorContext.Provider (PageEditor)");
  }
  return value;
}
