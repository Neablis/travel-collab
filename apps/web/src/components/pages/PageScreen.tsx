"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Page, PageDoc, TripDetail, TripGlobals } from "@tc/contracts";
import { fetchPage, updatePage } from "@/lib/pagesClient";
import { fetchTripDetail, fetchTripGlobals } from "@/lib/apiClient";
import { usePreferences } from "@/components/account/PreferencesProvider";
import { debounce } from "@/lib/debounce";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { PageTitle } from "./PageTitle";
import { Banner } from "@/components/ui/banner";
import { NodeSelection } from "@tiptap/pm/state";
import { PageEditor } from "@/components/pages/editor/PageEditor";
import { WidgetSettings } from "@/components/pages/editor/WidgetSettings";
import type { SelectedWidget } from "@/components/pages/editor/MacroEditorContext";
import { WidgetInsert, type MacroNode } from "@/components/pages/WidgetInsert";
import { Button } from "@/components/ui/button";
import type { Editor } from "@tiptap/react";
import { ReadOnlyPageDoc } from "@/components/pages/editor/ReadOnlyPageDoc";
import {
  inspectStoredPageDoc,
  toStoredPageDoc,
  type StoredPageDoc,
} from "@/components/pages/editor/storedPageDoc";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { AssistantBubble } from "@/components/assistant/AssistantBubble";
import { AskPill } from "@/components/assistant/AskPill";
import { phoneAskContext } from "@/components/assistant/phoneAskContext";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { useAskThread } from "@/components/assistant/useAskThread";
import type { ApiError } from "@/lib/apiClient";

type Status = "loading" | "ready" | "error";

// Debounce delay for content autosave. A `setTimeout`-based debounce (no
// existing utility in this repo — checked `lib/debounce.ts` didn't exist
// before adding it) is all this needs: keystrokes coalesce into one
// `updatePage` call ~1s after the user stops typing.
const AUTOSAVE_DELAY_MS = 800;

// What the assistant says when a turn wanted to write into a page that is being
// read rather than edited. It names the control that would let it through,
// because "I can't do that here" without one is a dead end.
const READING_REFUSAL = "I drafted that, but this page is open for reading — turn on Edit page and ask again to put it in.";

// Why this screen is the place ADR-038 decision 4 lives: it owns the autosave.
// The loss the ADR is about is not a bad migration, it is this component
// writing `getJSON()` back over a document the editor never understood, 800 ms
// after mounting it. The refusal has to happen before `PageEditor` renders,
// because by the time TipTap has fallen back to an empty document the content
// is already gone from memory.
//
// `Banner` rather than a hand-rolled box: it already carries `role="status"`
// and the palette's own `warning` tokens. The first draft of this used
// `bg-amber-50`, which renders as nothing at all — `globals.css` sets
// `--color-*: initial`, so Tailwind's default palette does not exist here.
function LockedNotice({ children }: { children: ReactNode }) {
  return <Banner variant="warning" className="mb-3">{children}</Banner>;
}

// Renders one page's editor. Fetches the page + the trip's detail (the same
// `fetchTripDetail` the board/lens system uses — pages don't need
// `TripProvider`'s optimistic-update machinery, they never write planning
// data) and wires `PageEditor`'s `value`/`onChange` to
/**
 * Displays a trip page and supports safe editing, widget insertion, autosaving, and assistant interactions.
 *
 * @param tripId - Identifier of the trip containing the page
 * @param pageId - Identifier of the page to display
 */
export function PageScreen({ tripId, pageId }: { tripId: string; pageId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [trip, setTrip] = useState<TripDetail | null>(null);
  // The account, for account-scope widgets (ADR-037 open question 2), READ FROM
  // THE PROVIDER the whole app shell already mounts (`(app)/layout.tsx`).
  //
  // It used to be a `fetchPreferences()` of its own into local state, which was
  // wrong twice: it duplicated the request on every notebook page, and — the
  // part that showed — `PreferencesProvider` updates the moment someone saves
  // in Account settings while this snapshot only refreshed on a route change,
  // so `account.name` went stale against a value the same session had just
  // changed. Found by Copilot on PR 139.
  //
  // `usePreferences` answers the defaults rather than throwing when no provider
  // is above it, which keeps the fail-soft rule the old comment described: a
  // notebook that will not open because a preferences read failed is a worse
  // outcome than one widget rendering "not set up", and the defaults
  // (`displayName: null`) are exactly what "not set up" renders from.
  const user = usePreferences();
  // The assistant's PRESENTATION turns on this, and after §23 that is the only
  // thing left that does. `AssistantRail` gates itself on nothing, so choosing
  // sheet-or-floating is the caller's and there is no CSS breakpoint that can
  // make the choice — which is the one job this hook still has here. The entry
  // point no longer needs it: `AskPill` carries its own `md:hidden`, so it is
  // right at first paint where an `isPhone` branch around it was one frame
  // late on every phone load. SPEC §13.5 still forbids anything floating over
  // data on a phone, which is why the bubble below stays desktop-only.
  const isPhone = useIsPhone();
  // Reading vs Editing — §18's one control with two states. Reading is the
  // traveller's view: no sidebar, no chrome row, no compose box, and the
  // document is read-only.
  //
  // **Opens in READING**, on Mitchell's call after walking the preview
  // (2026-09-04): *"reading should be default state, it opened in editing for
  // me"*. This reverses an earlier correction of mine, and the reason that
  // correction existed is worth keeping: making Reading the default the first
  // time broke `m7-solo-delight.spec.ts`'s hand-typed-prose walk, which clicks
  // into the page and types. That spec now clicks "Edit page" first — the right
  // fix, since a test that walks authoring should say so, rather than the
  // default silently being whatever an old spec assumed.
  const [editing, setEditing] = useState(false);
  // The live editor, handed up by `PageEditor` so the sidebar — which sits
  // beside the editor, not inside it — can insert at the cursor.
  const [editor, setEditor] = useState<Editor | null>(null);
  // Same fail-soft rule as `user` above, and for the same reason.
  const [globals, setGlobals] = useState<TripGlobals | null>(null);

  // SPEC §26: the widget whose settings the side channel is showing.
  //
  // **Cleared by KEY, not by the null the reporter sends.** Every mounted node
  // view runs the same effect, so on a click that moves the selection from A to
  // B, A's effect (`selected` went false -> report null) and B's (`selected`
  // went true -> report B) both run, in an order React decides. Dropping the
  // selection on any null would let A's clear land after B's set and close the
  // panel that had just opened. Matching the key means a clear only wins if the
  // widget currently being shown is the one saying it lost selection.
  const [selectedWidget, setSelectedWidget] = useState<SelectedWidget | null>(null);
  const handleWidgetSelected = useCallback((selection: SelectedWidget | null, reporterKey: string) => {
    setSelectedWidget((current) => {
      if (selection === null) {
        // A clear from a widget that is not the one on show is a stale effect
        // from the widget that just lost selection — ignore it.
        return current?.key === reporterKey ? null : current;
      }
      // **Keep the existing object when nothing has actually changed.**
      //
      // The reporter is a node view effect, and the `params` it sends is
      // `node.attrs.params ?? {}` — a fresh object on every render. Storing it
      // unconditionally re-renders this screen, which re-renders the node view,
      // which reports a new object, which re-renders this screen: a loop that
      // does not settle, and the panel it is rendering flickers out of the DOM
      // between frames. Comparing by value is what stops it; `key` plus the
      // serialised params is the whole of what the panel reads.
      if (
        current !== null &&
        current.key === selection.key &&
        JSON.stringify(current.params) === JSON.stringify(selection.params)
      ) {
        return current;
      }
      return selection;
    });
  }, []);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // The verdict on the document AS LOADED, taken once. It is deliberately not
  // recomputed from `page.content` as the user types: the question decision 4
  // asks is "was the thing we were handed safe to open", and re-asking it of
  // the editor's own output would let a session that started locked silently
  // unlock itself the moment TipTap emitted a document we happen to like.
  const [stored, setStored] = useState<StoredPageDoc | null>(null);
  // Set when the editor hands back something `PageDoc` cannot parse. It latches
  // for the session: whatever produced one unstorable document will produce the
  // next one too, and a screen that resumes autosaving after a single refusal
  // is a screen that eventually writes one.
  const [unstorable, setUnstorable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchTripGlobals(tripId).then((r) => {
      if (!cancelled && r.ok) setGlobals(r.value);
    });
    void Promise.all([fetchPage(tripId, pageId), fetchTripDetail(tripId)]).then(([pageResult, tripResult]) => {
      if (cancelled) return;
      if (!pageResult.ok) {
        setError(pageResult.error.message);
        setStatus("error");
        return;
      }
      if (!tripResult.ok) {
        setError(tripResult.error.message);
        setStatus("error");
        return;
      }
      setPage(pageResult.value);
      setStored(inspectStoredPageDoc(pageResult.value.content));
      setTrip(tripResult.value);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, pageId]);

  const saveContent = useMemo(
    () =>
      debounce((content: PageDoc) => {
        void updatePage(tripId, pageId, { content });
      }, AUTOSAVE_DELAY_MS),
    [tripId, pageId],
  );
  // Stable, so `PageEditor`'s effect does not re-run on every render and
  // re-publish the same editor.
  const handleEditorReady = useCallback((next: Editor | null) => setEditor(next), []);

  const saveContentRef = useRef(saveContent);
  saveContentRef.current = saveContent;
  useEffect(() => () => saveContentRef.current.cancel(), []);

  // The editor, held in a ref as well as in state, so the ask handler below —
  // which is created before `editor` exists and outlives several renders — can
  // reach the live one. Reading `editor` from the closure would insert into
  // whatever editor existed when the turn started.
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  // Editing, readable from a callback that outlives its render — see the
  // `page-inserts` guard below.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  // Which rename is the current one. See `handleRename`.
  const renameSeq = useRef(0);

  // **The notebook's AI surface is the assistant rail, not a prompt box.**
  // Mitchell, walking the preview (2026-09-04): *"This should be the same style
  // AI Assistant as on the trip page, not the top of the UI input box"*.
  //
  // It became possible in the same change that made it right. `ComposePanel`
  // sent one message and kept no thread, and its own header explained why it
  // could not do better: `compose_page` REPLACED the document, so *"a page that
  // accumulated turns would have to decide what 'draft this page' means the
  // second time"*. ADR-035 decision 5 made the tools insert-shaped, and
  // inserting has an obvious second time — every turn counts, in call order. So
  // the objection dissolved and the rail is simply the right surface.
  //
  // A page turn carries **no proposal**: the page tools insert, so there are no
  // write commands to collect and nothing to approve. That is why the rail's
  // two proposal callbacks are optional and omitted here rather than passed as
  // no-ops that would imply a review step exists.
  const ask = useAskThread({
    tripId,
    scope: { kind: "page", pageId },
    // /ask's own 400s are specific and actionable ("your message must be 4000
    // characters or fewer"); rewriting them here would throw that away. The
    // board's `askErrorMessage` branches on two trip-level refusal codes that
    // cannot reach a page, so this is deliberately the identity rather than a
    // copy of it that would go stale.
    errorMessage: (error: ApiError) => error.message,
    onEvent: (event, patchAnswer) => {
      // **The server's own refusal, which was being dropped on the floor.** A
      // page turn whose nodes fail registry validation finishes with
      // `page-error` and no content, and the request itself succeeds — so the
      // turn settled `idle` with an empty answer and the reader was told
      // nothing. `ComposePanel` surfaced this before it retired ("`Macro
      // "cost.day" params failed validation`" is a better answer than the
      // transport's, which will just say the turn worked); the machinery came
      // across and this did not. Found by Copilot on PR 139.
      //
      // It cannot go through `useAskThread`'s own `refuse`: this arrives on the
      // stream's FINAL chunk, and `runAsk` sets `idle` immediately afterwards
      // on a successful request, so the error status would be overwritten in
      // the same turn. Held here and merged into the rail's error slot instead.
      if (event.type === "page-error") {
        setTurnRefusal(event.message);
        return;
      }
      if (event.type !== "page-inserts") return;
      // **Reading never receives writes, and this is the guard that says so
      // rather than the abort timing.** A guard that depends on a stream
      // shutting down in time is a guard with a window in it — the last frame
      // can already be in flight. This asks the question that actually matters:
      // is this page still being edited?
      //
      // `editingRef`, not `editing`, because this callback outlives the render
      // it was created in — the closure's copy is whatever Editing was when the
      // turn started, which is exactly the wrong answer.
      //
      // **It says so rather than dropping the write silently.** The assistant is
      // available in Reading now (Mitchell: *"always available in both editing
      // and reading mode"*), so a reader can ask it to write and get an answer
      // whose whole content is an insert this refuses. Answering nothing there
      // reads as the assistant being broken; the note is the only thing that
      // distinguishes "refused" from "failed".
      if (!editingRef.current) {
        patchAnswer((turn) => ({ ...turn, text: `${turn.text}\n\n${READING_REFUSAL}` }));
        return;
      }
      // Already validated against the macro registry server-side and re-parsed
      // against `PageDoc` on the way in, so there is nothing left to check
      // here. It goes in through the SAME `insertContent` chain a click and a
      // drop use — one mechanism, so the AI cannot develop placement rules of
      // its own.
      //
      // **The insert does not TAKE the caret; it only keeps it (KI-2026-09-06-b).**
      // An unconditional `focus()` here stole focus from the composer the user
      // was still typing a follow-up into — and it stole it LATE, because
      // tiptap's `focus` command schedules `view.focus()` in a
      // `requestAnimationFrame` (`@tiptap/core` 2.27.2, `commands/focus.ts`).
      // The keystrokes before that frame stayed in the composer and every one
      // after it — `Enter` included — was typed into the page instead, silently:
      // the follow-up was never sent and its characters were appended to the
      // document and autosaved.
      //
      // **Placement is unchanged, which is why this is not a product decision.**
      // `focus()` with no position never touches the selection: it resolves to
      // `editor.state.selection`, sees the selection is the same, and does
      // nothing but schedule that frame. `insertContent` lands at
      // `state.selection`, which a ProseMirror state always has whether or not
      // the view holds DOM focus — so the node goes exactly where it went
      // before. The guarded call is a no-op by tiptap's own early return
      // (`view.hasFocus() && position === null`); it is written out rather than
      // deleted so that "the editor keeps the caret when it already had it"
      // stays a property of this code and not of a library internal.
      //
      // `liveEditor`, not `editor`: the state variable of that name is this
      // closure's stale copy, which is the whole reason `editorRef` exists.
      const liveEditor = editorRef.current;
      if (!liveEditor) return;
      const insert = liveEditor.chain();
      if (liveEditor.isFocused) insert.focus();
      insert.insertContent(event.content.content as never).run();
    },
  });
  const [assistantOpen, setAssistantOpen] = useState(false);
  // The server's refusal for the LAST page turn, or null. Separate from
  // `ask.askError` (which is the transport's) and merged with it at the rail,
  // because only one of the two can be true of any given turn.
  const [turnRefusal, setTurnRefusal] = useState<string | null>(null);

  // **Closing the surface hangs up on the turn.** Unmounting `AssistantRail`
  // does not: `useAskThread` lives HERE, so its cleanup runs only when the whole
  // screen goes, and a turn still streaming would land its `page-inserts` in a
  // document the user had just put back into Reading — and autosave it. Found
  // by Copilot and CodeRabbit on PR 139.
  const closeAssistant = () => {
    ask.cancel();
    setAssistantOpen(false);
  };
  // **Leaving Editing no longer hangs up, and that is a reversal.** It did,
  // because the assistant was an editing-only control and leaving Editing was
  // leaving the assistant. It is available in both modes now (Mitchell:
  // *"always available in both editing and reading mode"*), so cancelling here
  // would kill a conversation the user can still have — and the write it was
  // guarding against is refused by the `page-inserts` guard above, which is
  // where it always belonged: cancellation cannot close that window on its own.
  // **The rename, which used to be a button on the index list.** Mitchell,
  // 2026-09-06: *"rename shouldn't be a button here, the title should be at
  // the top of the notebook as a h1 and when you edit the title it does the
  // actual edit/rename"*. Same `updatePage` call the index's inline rename
  // made — only the surface moved.
  //
  // Not debounced, unlike the content autosave above: a title is committed
  // once, on blur or Enter, rather than on every keystroke.
  const handleRename = (title: string) => {
    const previousTitle = page?.title ?? null;
    // A rename says nothing about the title once a later one has been sent.
    // Two edits in quick succession finish in whatever order the network gives
    // them, and without this counter the FIRST one's completion still runs:
    // its failure puts `previousTitle` back over the second name the user can
    // see, and its success writes the older title back over the newer one.
    // CodeRabbit found the failure half on #149; the success half is the same
    // race and is fixed by the same guard.
    const seq = ++renameSeq.current;
    setPage((prev) => (prev === null ? prev : { ...prev, title }));
    void updatePage(tripId, pageId, { title }).then((result) => {
      if (seq !== renameSeq.current) return;
      if (!result.ok) {
        // Put the old name back rather than leaving the screen showing a name
        // the server never took. `setError`/`setStatus("error")` — the pair
        // this screen uses elsewhere — replaces the whole document with an
        // alert, which is the right weight for "the notebook would not load"
        // and much too heavy for "the rename did not stick".
        setPage((prev) => (prev === null || previousTitle === null ? prev : { ...prev, title: previousTitle }));
        return;
      }
      setPage((prev) => (prev === null ? prev : { ...prev, title: result.value.title, updatedAt: result.value.updatedAt }));
    });
  };

  const toggleEditing = () => setEditing((was) => !was);

  if (status === "loading") return <PageContainer>Loading…</PageContainer>;
  if (status === "error" || page === null || trip === null || stored === null) {
    return (
      <PageContainer>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href={`/trips/${tripId}/pages`}>← Notebooks</Link>
      </PageContainer>
    );
  }

  // `getJSON()` in, a storable document out — or nothing written at all. The
  // parse is not a formality: it stamps `v` (decision 2) and it is the last
  // place a document the editor mangled can be stopped.
  const handleContentChange = (content: unknown) => {
    const storable = toStoredPageDoc(content);
    if (storable === null) {
      saveContent.cancel();
      setUnstorable(true);
      return;
    }
    setPage((prev) => (prev === null ? prev : { ...prev, content: storable }));
    saveContent(storable);
  };

  // Click-to-insert. `insertContent` puts the node at the current selection,
  // which is what "it puts the widget inline at cursor" means (ADR-037 decision
  // 4); `focus()` first so a click in the popover — which moved focus out of
  // the editor — still lands where the caret was.
  //
// Drag-and-drop and the slash menu are the SAME command from a different
  // origin, and they live in `PageEditor` because both need a position the
  // editor computes (a drop point, a caret range) rather than the selection.
  //
  // It takes one node OR MANY, because the assistant inserts through it too
  // (ADR-035 decision 5): a turn's prose and widgets arrive as a node list and
  // land the same way a click does. One mechanism, so the AI path cannot
  // develop placement rules of its own.
  const insertAtCursor = (node: MacroNode | readonly unknown[]) => {
    // **Selects what it just inserted**, which SPEC §26 makes load-bearing
    // rather than a nicety. Before §26 a widget arrived with its chrome row
    // already attached, so "inserted" and "configurable" were the same moment.
    // Now the settings live in the side channel and appear only for the
    // SELECTED widget — so an insert that left the selection in the text would
    // land a widget bound to everything and leave the column showing the insert
    // rail, with no indication that the thing to do next is point it somewhere.
    //
    // **Scans the inserted range for the macro rather than assuming it sits at
    // the start position**, and that distinction is the whole of whether this
    // works for block-shaped widgets.
    //
    // `insertContent` leaves the cursor after what it inserted, so the range
    // from the old `from` to the new selection is exactly what landed. For an
    // INLINE widget (`cost`) the macro is the first node in that range and
    // `nodeAt(from)` finds it. For a BLOCK one (`day.detail`, `stop.rows`) the
    // insert brings a paragraph with the macro inside it — so `nodeAt(from)` is
    // the paragraph, the check failed, and nothing was selected. Which meant
    // every block widget landed with its settings unopened while every inline
    // one opened them: a split nobody designed, found by an e2e walk on
    // `stop.rows` after the inline cases had all gone green.
    const at = editor?.state.selection.from;
    editor
      ?.chain()
      .focus()
      .insertContent(node as never)
      .command(({ tr, dispatch }) => {
        if (at === undefined || dispatch === undefined) return true;
        let macroPos: number | null = null;
        tr.doc.nodesBetween(at, Math.max(at, tr.selection.to), (child, pos) => {
          if (macroPos !== null) return false;
          if (child.type.name === "macro") macroPos = pos;
          return macroPos === null;
        });
        if (macroPos === null) return true;
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, macroPos)));
        return true;
      })
      .run();
  };

  // What the phone sheet says it is looking at, derived rather than written
  // here (SPEC §23, DRIFT §2i: the context line, the placeholder and the quick
  // asks are all a function of "which phone tab, and is a page open").
  //
  // **`unsetUpWidgets: null`, and that is the honest answer, not a placeholder
  // for zero.** It gates "What is not set up?", and `phoneAskContext` withholds
  // that ask on an unknown count precisely so it is never offered on a page
  // with nothing outstanding. Counting is possible in principle — `renderMacro`
  // is pure and reports `unbound` — but the count is only true once `globals`
  // has landed, and `globals` here is fail-soft and nullable, so a count taken
  // during (or after a failed) load would report widgets as unset up that are
  // bound. A wrong number is worse than no number when the number's whole job
  // is deciding whether to promise an answer. The doc-walk that would total it
  // belongs in `@tc/pages` beside `renderMacro`, not in a screen.
  const phoneAsk = phoneAskContext(trip, null, {
    tab: "notebook",
    page: { pageId, title: page.title, unsetUpWidgets: null },
  });

  // Bare, with no margin of its own: it is a flex item in the row above the
  // container, and a bottom margin there pushes it off the toggle's baseline.
  // The locked branch below, where it is the first block in normal flow,
  // supplies its own.
  const backLink = (
    <Link href={`/trips/${tripId}/pages`} className="text-sm text-slate hover:text-ink">
      ← Notebooks
    </Link>
  );

  // Read-only, and every write path off: no autosave (nothing calls
  // `saveContent`), and no ComposePanel — it inserts into an editor this
  // branch deliberately never mounts, and anything it did land would be
  // autosaved over the content we just refused to risk.
  //
  // **No Edit toggle here either.** ADR-038 decision 4's whole point is that
  // this document must not be mounted in an editor at all, so offering a
  // control that promises editing would be a button that cannot keep its word.
  if (stored.status !== "mountable") {
    return (
      <PageContainer>
        <div className="mb-2">{backLink}</div>
        {/* Plain, not a `PageTitle`: this branch exists precisely so nothing
            here can write to a document the app cannot safely read, and a
            rename is a write. It is still the page's `h1`. */}
        <Heading level={1}>{page.title}</Heading>
        <div className="mb-3 mt-3">
          {stored.status === "unsupported" ? (
            <LockedNotice>
              This notebook uses something this version of the app doesn&apos;t know how to edit
              ({stored.unsupportedTypes.join(", ")}). You can read it here — editing is off so
              nothing gets overwritten. Reloading once the app updates should bring it back.
            </LockedNotice>
          ) : (
            <LockedNotice>
              This notebook is stored in a format this version of the app can&apos;t read, so
              it&apos;s locked to protect it. Nothing has been lost. Reloading once the app
              updates should bring it back.
            </LockedNotice>
          )}
        </div>
        {stored.status === "unsupported" ? <ReadOnlyPageDoc doc={stored.doc} /> : null}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* The row above the container: where you came from on the left, the one
          mode toggle on the right (dc.html:2326). Everything that acts on the
          document itself is inside the container with it. */}
      {/* `mt-3` because this row carried `mb-3` and nothing above it, and
          `PageContainer` is `mx-auto w-full px-6` — horizontal padding only —
          so the row landed hard against the global header (2026-09-06 preview
          feedback, finding 7). Spaced here rather than in `PageContainer`,
          which five other surfaces share. */}
      {/* **`md:sticky` (KI-2026-09-05-b).** Mitchell, on the PR 141 preview:
          *"togglable on a large page without having to scroll up and down"*.
          Below `md` this stays in normal flow — SPEC §13.5 rules out a
          floating control on a phone, and §19's phone Notebook keeps the
          toggle exactly where it already sits, at the top of the page it is
          reading or editing. `md:top-14` pins it directly under `AppHeader`
          (`sticky top-0 h-14` — `TripHeader`'s own comment names it the same
          way), so the two sticky bars stack rather than overlap. `md:bg-paper`
          is the page's own background (`body`'s `bg-paper`), not the card's:
          without it the document's prose would show through and scroll
          underneath a see-through bar. The `mt-3 mb-3` MARGIN that spaces this
          row from the top bar and the card below is swapped for `md:my-0
          md:py-3` padding at the same breakpoint: a margin sits outside a
          sticky element's own painted box, so the background above would not
          cover it and the document would show through that strip while
          pinned. */}
      <div className="mt-3 mb-3 flex flex-wrap items-center justify-between gap-3 md:sticky md:top-14 md:z-10 md:my-0 md:bg-paper md:py-3">
        {backLink}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={editing ? "primary" : "secondary"}
            aria-pressed={editing}
            onClick={toggleEditing}
          >
            {editing ? "Done editing" : "Edit page"}
          </Button>
          {/* The phone's entry to the assistant, and it is now the SAME control
              this app puts on Plan, Map and the Notebook index (SPEC §23) —
              this screen's own `◎ Assistant` button was one of the three
              different entry points §23 exists to collapse into one.

              **After the mode toggle, because §23's claim is positional**:
              *"last item in the top row… same pill, same label, same position,
              so it never moves as you change tabs."* It shipped BEFORE the
              toggle on this screen alone (Copilot, PR #148), which made the
              open page the one surface of the four where the pill sat
              somewhere else — the exact inconsistency §23 exists to end.

              It only OPENS. The button it replaces toggled, because it was the
              sheet's only dismissal; the sheet owns two of its own now (the ✕
              and the scrim), and a third that also has to say which state it is
              in is a control competing with the surface it opened. Closing
              still runs `closeAssistant`, so hanging up on a turn in flight is
              unchanged — `onHide` below is where it goes. */}
          <AskPill open={assistantOpen} onOpen={() => setAssistantOpen(true)} />
        </div>
      </div>
      {unstorable ? (
        <div className="mb-3">
          <LockedNotice>
            Your last change produced something this version of the app can&apos;t save, so saving
            has stopped to protect what&apos;s already here. Copy anything new before reloading.
          </LockedNotice>
        </div>
      ) : null}
      {/* **The document sits on a page, not on the app's background.**
          Mitchell, on the preview: *"There should be a contrainer over the
          page"* — with the design beside it (dc.html:2333), which puts the
          title and the whole document on one raised `Card`, generously padded,
          with nothing else inside it. A notebook page is a document you read,
          and a document has an edge; without one the prose ran flush into the
          trip chrome above it and there was nothing to say where the page
          began.

          `p-0` clears the Card's own 12px and the padding is set here instead,
          because the design's inset is a document margin (40/52px) rather than
          a card's — bigger than any card in the app, and the point. It steps
          down on a narrow viewport, where 52px of gutter is most of the
          column. */}
      {/* SPEC §26's desktop side channel. The page and the 320px column are
          flex siblings, and **the column exists only in Editing**:

          > The column is not reserved while reading: the page runs full width
          > until edit mode opens it. That means the measure changes when you
          > enter edit mode (lines rebreak once); switching between rail and
          > settings does not reflow, since both are 320px. This tradeoff was
          > chosen deliberately over an empty 320px gutter sitting there the
          > whole time you read.

          `items-start` so the column does not stretch to the document's height
          and pin its own sticky position to the bottom of a long page. */}
      <div className="flex items-start gap-6">
      <Card raised className="min-w-0 flex-1 overflow-hidden p-0">
        <div className="flex flex-col px-5 py-6 sm:px-12 sm:py-10">
          {/* `h1`, and the document's own — the trip's name is the app chrome
              above this card, not this page's heading. Editable only in
              Editing: Reading is the traveller's view (§18) and a title that
              accepts a caret there would be the one piece of chrome left in a
              mode whose whole point is not having any. */}
          <PageTitle title={page.title} editable={editing} onRename={handleRename} />
          {/* `mt-4` is the seam between the title and the document. It used to
              be `mt-3` on a wrapper that also held the editor and the rail as
              flex siblings; the rail is neither a sibling nor in this box any
              more, so the row went with it. */}
          <div className="mt-4 min-w-0">
            <PageEditor
              detail={trip}
              context={page.context}
              user={user}
              globals={globals}
              value={stored.doc}
              onChange={handleContentChange}
              onEditorReady={handleEditorReady}
              editable={editing}
              onWidgetSelected={handleWidgetSelected}
            />
          </div>
          {/* dc.html:2443 — the insert affordance lives at the FOOT of the
              document, next to the sentence naming the other way in. It was in
              the header row beside "Edit page", which put a control that acts
              on the document outside the document.

              Reading shows neither (§18), and neither does an editor that has
              not mounted yet: `useEditor` returns null on the first render
              (`immediatelyRender: false`), so a click landing before it
              resolves reached `editor?.chain()` and was silently dropped — a
              button that looks ready and does nothing (CodeRabbit, PR 139). */}
          {/* **`md:hidden` since SPEC §26 gave the desktop a column.** The
              insert rail is now the column's resting state, and two buttons
              called "Insert a widget" on one screen is the duplication project
              rule 4 forbids — it was also, concretely, an ambiguous query in
              every test that reached for one.

              It stays at the foot on a PHONE, which has no column: §26's phone
              half is an inspector for a widget you already have, not a way to
              add one, so removing this outright would leave a phone with no
              insert affordance at all. The `/` hint goes with it, being about
              the keyboard.

              **`isPhone`, not a `md:hidden` class**, and the pair below is why:
              the two affordances are the SAME component with the same
              accessible name, so rendering both and hiding one in CSS leaves
              two controls called "Insert a widget" in the tree. That is a real
              ambiguity for assistive tech, not only for a test — unlike
              `AskPill`/`AssistantBubble`, where the CSS approach is right
              because the cost of guessing wrong for one paint is a floating
              button §13.5 forbids. Here a one-paint flash of the wrong
              affordance is harmless and duplicate naming is not. */}
          {editing && editor !== null && isPhone ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <WidgetInsert detail={trip} globals={globals} onInsert={insertAtCursor} />
              <span className="text-xs text-slate">
                or press <span className="rounded-sm bg-moss px-1 font-mono">/</span> anywhere in the page
              </span>
            </div>
          ) : null}
        </div>
      </Card>
      {/* The column's two states (§26): the insert rail when nothing is
          selected, the selected widget's settings when something is. One
          column, one place to look, no second panel to manage.

          `max-md:hidden` because at 390px a 320px column is the whole screen —
          the phone gets the sheet below instead, which is §26's other half.
          `sticky` so the settings stay beside the widget on a long page rather
          than scrolling away from the thing they configure. */}
      {editing && !isPhone ? (
        <aside
          className="sticky top-6 w-80 shrink-0"
          aria-label={selectedWidget === null ? "Insert a widget" : "Widget settings"}
        >
          <Card raised className="p-4">
            {selectedWidget === null ? (
              <div className="flex flex-col gap-3">
                <Text variant="muted">Pick a widget to add, or select one on the page to change it.</Text>
                {editor !== null ? (
                  <WidgetInsert detail={trip} globals={globals} onInsert={insertAtCursor} />
                ) : null}
              </div>
            ) : (
              <WidgetSettings selection={selectedWidget} detail={trip} globals={globals} />
            )}
          </Card>
        </aside>
      ) : null}
      </div>
      {/* §26's phone inspector: the same rows, in the sheet the phone bind
          controls already used, opened by selecting the widget rather than by a
          44px button sitting in the document flow. The button was the last
          widget control left in the prose. */}
      <Sheet
        open={isPhone && editing && selectedWidget !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedWidget(null);
        }}
        size="bottom"
        title="Widget settings"
      >
        {selectedWidget === null ? null : (
          <WidgetSettings selection={selectedWidget} detail={trip} globals={globals} />
        )}
      </Sheet>
      {/* **The assistant floats in the corner and is available in both modes.**
          Mitchell, on the preview: *"Assistant shouldnt be at the top, it
          should be on the bottom right on desktop, floating till open, and
          always available in both editing and reading more"*. It was a header
          button that existed only while editing.

          Both of those changed, and the second is the one with a consequence:
          a page in Reading can now be asked to write. It is refused, by the
          `page-inserts` guard above rather than by hiding the surface — and the
          refusal SAYS so, because an assistant that answers nothing reads as
          broken rather than as declining.

          The panel is not unmounted between openings: closing it hangs up on
          the turn (`closeAssistant`) but the thread is `useAskThread`'s, which
          lives on this screen, so a conversation survives being put away. */}
      {!isPhone && !assistantOpen ? (
        <AssistantBubble open={assistantOpen} onOpen={() => setAssistantOpen(true)} />
      ) : null}
      {assistantOpen ? (
        <AssistantRail
          // Floating on desktop; §23's bottom sheet on a phone. It used to be
          // `docked`, which below 768px was KI-84's full-screen takeover —
          // Mitchell was shown that conflict on 2026-09-05 and chose §23's
          // sheet, reversal and all (see `.assistant-sheet` in globals.css,
          // which carries the reasoning where the geometry is).
          //
          // The first-paint flash `AssistantRail`'s `presentation` note warns
          // about is not reachable here: `useIsPhone` starts `false` and
          // corrects in an effect, but this rail mounts only when
          // `assistantOpen` is true, `assistantOpen` starts `false`, and the
          // only things that set it are a tap on `AskPill` or on the bubble.
          // Effects have run long before a user can tap, so there is no frame
          // in which `isPhone` is stale AND the rail is on screen.
          presentation={isPhone ? "sheet" : "floating"}
          // The phone's line is derived from the surface (§23); the desktop's
          // is the panel's own and is deliberately left alone — "Looking at" is
          // the floating panel's voice, "Asking about" is the sheet's, and the
          // sheet is the one whose scope a user cannot otherwise see.
          contextLine={isPhone ? phoneAsk.contextLine : `Looking at ${page.title}`}
          scope={{ kind: "page", pageId }}
          turns={ask.thread}
          // Nothing on the desktop, for the reason this has always given: the
          // board derives its four from real trip state
          // (`suggestedQuestions.ts`), a page has no equivalent, and four fixed
          // prompts would be the hardcoded array M16 Wave 2 deleted wearing a
          // notebook badge. §23 asks the phone for two, and `phoneAskContext`
          // supplies them under the same rule — "What is not set up?" is
          // withheld until something can prove there is anything to set up.
          suggestions={isPhone ? phoneAsk.quickAsks : []}
          // Same branch, same way round, and for the reason directly above:
          // §23 rewrites the phone's copy and leaves the desktop panel's alone.
          emptyHint={isPhone ? phoneAsk.emptyHint : undefined}
          asksRemaining={ask.asksRemaining}
          restoreDraft={ask.restoredDraft}
          onNewConversation={() => {
            setTurnRefusal(null);
            ask.startNewConversation();
          }}
          // Cleared before each turn, so a refusal is about the question just
          // asked and not the one before it.
          onAsk={(text) => {
            setTurnRefusal(null);
            void ask.runAsk(text);
          }}
          asking={ask.asking}
          askError={ask.askError ?? turnRefusal}
          simulated={ask.simulated}
          onHide={closeAssistant}
        />
      ) : null}
    </PageContainer>
  );
}
