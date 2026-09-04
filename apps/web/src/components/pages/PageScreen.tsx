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
import { Banner } from "@/components/ui/banner";
import { PageEditor } from "@/components/pages/editor/PageEditor";
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
import { Card } from "@/components/ui/card";
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
// `pagesClient.updatePage`, debounced.
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
  // The assistant's presentation turns on this and nothing else does. SPEC
  // §13.5 forbids anything floating over data on a phone ("No floating action
  // button"), so the bubble is desktop-only and the phone opens the same panel
  // from a control in the page header.
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
      editorRef.current?.chain().focus().insertContent(event.content.content as never).run();
    },
  });
  const [assistantOpen, setAssistantOpen] = useState(false);

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
    editor?.chain().focus().insertContent(node as never).run();
  };

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
        <Heading level={2}>{page.title}</Heading>
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {backLink}
        <div className="flex flex-wrap items-center gap-2">
          {/* The phone's entry to the assistant. SPEC §13.5 forbids a floating
              control over data on a phone, so the bubble below is desktop-only
              and this is what replaces it — a header control, not a pill over
              the page. Both modes, like the bubble. */}
          {isPhone ? (
            <Button
              variant="secondary"
              aria-pressed={assistantOpen}
              onClick={() => (assistantOpen ? closeAssistant() : setAssistantOpen(true))}
            >
              <span aria-hidden>◎</span> Assistant
            </Button>
          ) : null}
          <Button
            variant={editing ? "primary" : "secondary"}
            aria-pressed={editing}
            onClick={toggleEditing}
          >
            {editing ? "Done editing" : "Edit page"}
          </Button>
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
      <Card raised className="overflow-hidden p-0">
        <div className="flex flex-col px-5 py-6 sm:px-12 sm:py-10">
          <Heading level={2}>{page.title}</Heading>
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
          {editing && editor !== null ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <WidgetInsert detail={trip} globals={globals} onInsert={insertAtCursor} />
              <span className="text-xs text-slate">
                or press <span className="rounded-sm bg-moss px-1 font-mono">/</span> anywhere in the page
              </span>
            </div>
          ) : null}
        </div>
      </Card>
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
          // Floating on desktop; on a phone the same panel takes the screen,
          // which is what `.assistant-rail` already does below 768px.
          presentation={isPhone ? "docked" : "floating"}
          contextLine={`Looking at ${page.title}`}
          scope={{ kind: "page", pageId }}
          turns={ask.thread}
          // No suggestion chips. The board derives its four from real trip
          // state (`suggestedQuestions.ts`); a page has no equivalent to
          // derive from, and inventing four fixed prompts here would be the
          // hardcoded array M16 Wave 2 deleted, wearing a notebook badge.
          suggestions={[]}
          asksRemaining={ask.asksRemaining}
          restoreDraft={ask.restoredDraft}
          onNewConversation={ask.startNewConversation}
          onAsk={(text) => void ask.runAsk(text)}
          asking={ask.asking}
          askError={ask.askError}
          simulated={ask.simulated}
          onHide={closeAssistant}
        />
      ) : null}
    </PageContainer>
  );
}
