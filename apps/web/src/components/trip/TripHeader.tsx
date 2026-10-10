"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, MoreHorizontal } from "lucide-react";
import { travellerIds, type TripAccess } from "@tc/contracts";
import { PersonChip } from "@/components/ui/person-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Popover } from "@/components/ui/popover";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { tripSpend } from "@/lib/cost";
import { isDemoTripId } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";
import { useIsPhone } from "@/lib/useIsPhone";
import { displayNameFor } from "@/lib/displayName";
import { settingsSectionFrom, withoutSettingsParam, type SettingsSection } from "@/lib/tripSettingsLink";
import { HistoryPanel } from "@/components/board/HistoryPanel";
import { SuggestionsChip } from "@/components/board/SuggestionsChip";
import { PeopleProvider } from "@/components/pages/people";
import { UndoRedoControls, useUndoRedoShortcuts } from "@/components/board/UndoRedoControls";
import { AskPill } from "@/components/assistant/AskPill";
import { SettingsSheet } from "./SettingsSheet";
import { TripMetaPill, tripCounts, tripDateRange } from "./TripMetaPill";
import { BudgetChip } from "./BudgetChip";
import { InstallNudge } from "@/components/install/InstallNudge";

// The bounded chrome surface (design-system.md surface vocabulary, Pattern 4):
// trip identity (name + status) on one row with Share / Add stop / sync /
// History, then the meta pill and budget chip together on the next. A visual
// boundary (bg-surface + border-hairline) separates this chrome from lens
// content below (#14).
//
// Nothing in the header edits the trip directly any more. The title is the
// door to Trip settings, and every field — name included — is edited in
// there; the inline rename Input, its pencil, and the separate settings cog
// are all gone (Mitchell, preview feedback on PR #55). Undo/redo moved into
// the History popover in the same pass, keeping its ⌘Z binding out here where
// it stays mounted.
export function TripHeader({
  tripId,
  assistantOpen = false,
  onOpenAssistant,
  children,
  pinned,
  conflicts,
  installNudge = false,
}: {
  tripId: string;
  /**
   * Whether the assistant is on screen, for the phone Ask pill's
   * `aria-expanded`. Passed in rather than held here: `TripBoardScreen` owns
   * the assistant's visibility (`useAssistantVisibility`), the rail it opens is
   * that screen's child, and a second copy of the flag up here would be free to
   * disagree with the one the rail is actually rendered from.
   */
  assistantOpen?: boolean;
  /**
   * Opens the assistant, or `undefined` where there is no assistant to open —
   * which is what withholds the pill entirely rather than rendering a control
   * with nothing behind it. `/demo` is that case today: `/api/trips/:id/ask`
   * refuses the demo trip outright (KI-79), so the demo board passes nothing
   * here for the same reason it renders no launcher.
   */
  onOpenAssistant?: () => void;
  children?: React.ReactNode;
  /**
   * What pins under the phone's one row, below 768px only: Plan's day rail
   * (M39 D6). Inside the header so `--sticky-stack-height` counts it, and so
   * the board's sticky offsets clear it. The caller decides when there is one.
   */
  pinned?: React.ReactNode;
  /**
   * The phone's conflict count (M39 D9), beside Suggestions in the pinned row,
   * below 768px only: above it the banner over Plan's columns is the surface.
   * Built by the caller, which owns where a jump to a stop goes; handed the
   * row's `⋯`, which is where focus goes once the last conflict is dismissed.
   * The `⋯` rather than Ask: it is the next control in the row, and on a phone
   * it is always there, where Ask is withheld on /demo.
   */
  conflicts?: (neighbour: React.RefObject<HTMLButtonElement | null>) => React.ReactNode;
  /**
   * Whether this view may carry the phone's install nudge (Overview and Plan
   * of a signed-in trip). The nudge applies every other rule itself.
   */
  installNudge?: boolean;
}) {
  // Render from `activeTrip`, not `trip`: `trip` is the server-confirmed
  // detail only, while `activeTrip` folds in TripProvider's optimistic
  // pending queue (the same value TripBoardScreen/ActivityEditorSheet already
  // render from). Reading `trip` here meant a rename/date/budget edit sat in
  // the optimistic queue correctly but never became visible until the server
  // round-trip confirmed it. `trip` is kept only for the existence/loading gate.
  const {
    trip,
    activeTrip,
    history,
    status,
    pending,
    dispatch,
    applyOutcome,
    preview,
    readOnly,
    canEditBoard,
    boardMode,
    accessUnknown,
    draft,
    noteInvites,
    access,
    refreshAccess,
  } = useTrip();
  // Task 9: "Add stop" is a real trigger for the same portable activity
  // editor Board's own "+ Add activity" button opens (Board.tsx) — no
  // dayId prefill, identical to that button's own openCreate() call.
  // TripHeader now renders inside EditorHost (trips/[tripId]/page.tsx wraps
  // TripBoardScreen, which mounts TripHeader, in <EditorHost>), so this hook
  // is always safe to call here.
  const { openCreate } = useEditor();
  const [historyOpen, setHistoryOpen] = useState(false);
  // The phone's `⋯`, which History hands focus back to on close: its own
  // button is `display: none` there, and focus sent to it falls to <body>.
  const tripActions = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The phone's overflow menu opens what an item names only once it has
  // closed. Radix hands focus back to the menu's trigger as it closes, and a
  // popover or sheet opened in the same tick reads that focus as a click
  // outside and shuts again. So the item names what to open, and the menu's
  // close-focus handler opens it instead of moving focus.
  const afterMenu = useRef<"add" | "history" | "settings" | null>(null);
  // Which half of the header holds History and the trip's badges. CSS draws
  // the rest of the phone row (the `max-md:` classes below); these two cannot
  // be drawn twice and hidden once. A popover's open state would open both
  // copies, and a second "Viewer" badge is a second match for every query
  // that finds the first. `false` until the effect runs, so the first phone
  // paint has no badges under the row for a frame, never a desktop header.
  const isPhone = useIsPhone();
  // The section the sheet was opened at: People from the avatar stack, or
  // whatever a `?settings=` link named; null for the sheet's top.
  const [settingsAt, setSettingsAt] = useState<SettingsSection | null>(null);
  // **A link into Trip settings** (M37): Home's *Invite who's coming* and
  // *Choose a cover photo* land here with `?settings=people|cover`, which is
  // the avatar stack's state reached from another page. Read once, after
  // mount, from `window.location` rather than `useSearchParams`: it is a
  // one-shot instruction, not state the header follows, and an effect keeps
  // the server render and the first client frame the same.
  //
  // Once per mount, so a `?settings=` reached by a client-side navigation to
  // the trip the header is already showing would not open the sheet. Today's
  // only entry points are Home's links, and leaving Home for a trip mounts a
  // fresh header; a link from inside the trip page would need this to follow
  // the URL instead.
  useEffect(() => {
    const section = settingsSectionFrom(window.location.search);
    if (section === null) return;
    setSettingsAt(section);
    setSettingsOpen(true);
  }, []);
  // **The delete toast is gone with the verb that raised it** — M26 link 6a,
  // DRIFT D13. A15 built this level's toast because the settings sheet's own
  // subtree unmounts on a successful delete and could not host one; with
  // Delete moved to the trip card's popover on Home (SPEC §34.2, §27), Home's
  // own toast — which has always been there, one level up from this one — is
  // the only one, and `undoDelete` went with it.
  //
  // The `applyOutcome` reconciliation A15-fix added is not lost, only moved
  // out of reach: nothing on this screen can delete this trip any more, so
  // there is no window in which `trip.status` could go stale against the
  // server. Home reloads its list instead.

  // Above the early return, because it owns a useEffect and hooks cannot run
  // conditionally — and because the whole point of splitting it out is that it
  // stays mounted when the History popover (which now holds the buttons) is
  // closed. Gated on `preview.seq === null` so ⌘Z is inert while previewing a
  // past version, exactly as it was when the buttons carried the binding.
  useUndoRedoShortcuts({
    // `!readOnly` here as well as on the buttons: TripProvider's `dispatch`
    // already refuses a viewer's write, so pressing ⌘Z could not mutate the
    // trip — but it DID surface "You have view-only access to this trip." for
    // a shortcut whose controls a viewer cannot even see. Gated at the same
    // layer as the buttons so the header is consistent about it, and so a
    // future dispatch that does not go through the provider inherits the gate
    // (CodeRabbit, PR #71).
    canUndo: !readOnly && preview.seq === null && (history?.canUndo ?? false),
    canRedo: !readOnly && preview.seq === null && (history?.canRedo ?? false),
    onUndo: () => void dispatch({ type: "UndoLastChange", tripId }),
    onRedo: () => void dispatch({ type: "RedoChange", tripId }),
    isBusy: pending,
  });

  const publishStickyStack = useStickyStackHeight();

  if (trip === null || activeTrip === null || status !== "ready") return null;

  // Handoff §2: "neutral `Badge` state" next to the trip name — just a
  // display of activeTrip.status ("active" | "deleted", contracts/trip.ts),
  // capitalized for display. Not a new capability, purely presentational.
  const statusLabel = activeTrip.status.charAt(0).toUpperCase() + activeTrip.status.slice(1);

  // Who is travelling and what state the trip is in: beside the title on a
  // desktop, and on the line under the phone's pinned row, which scrolls away
  // (M39 D6). Built once so the two placements cannot drift; `isPhone` picks
  // the one that renders.
  const identity = (
    <>
      <TravellerStack
        access={access}
        onOpen={() => {
          setSettingsAt("people");
          setSettingsOpen(true);
        }}
      />
      <Badge variant="neutral">{statusLabel}</Badge>
      {/* M11 link 3: a viewer's trip is theirs to read, not to change.
          The server refuses their writes either way (accessPolicy.ts);
          the badge plus the gates below are what stop them finding that
          out by clicking. The badge ALONE was the whole of it until
          CodeRabbit read PR #71 — Share, Add stop, undo/redo and Revert
          were all still live for a viewer, so this comment was making a
          promise the header did not keep. */}
      {/* "Viewer", not "View only" — one word rather than two
          (Mitchell, 2026-08-30 design pass: "dont use two words when
          one will do, word wraps cause issues"). It also names the
          role, which is what the badge stands in for, in the same word
          the invite flow already uses. */}
      {/* A suggester is `readOnly` too (W8) but not a viewer: their
          badge is their role word (W24). */}
      {readOnly && <Badge variant="info">{boardMode === "suggest" ? "Suggester" : "Viewer"}</Badge>}
      {/* A suggester's unsent draft, said where it is seen from anywhere
          on the board (W70; Mitchell's production test, 2026-10-04). The
          save light cannot say it: it counts a draft as nothing (W38),
          because nothing is trying to send one. The bottom bar holds the
          Send; this is the reminder that there is something to send. */}
      {draft !== null && draft.count > 0 && (
        <Badge variant="warning" title="Your changes wait in the bar at the bottom until you send them">
          {`${draft.count} not sent`}
        </Badge>
      )}
      {/* The access read failed, so this board is live on an assumption
          rather than on an answer (TripProvider's `load` explains why
          that is the deliberate choice). Said out loud here, beside the
          role badge it stands in for, so a write the server then refuses
          reads as the consequence of a known-unknown rather than as the
          app breaking. */}
      {accessUnknown && (
        <Badge
          variant="warning"
          title="We could not check your access to this trip. You can keep working, but the server may refuse changes."
        >
          Access unknown
        </Badge>
      )}
    </>
  );

  // The phone row's `⋯` (M39 D6): what the desktop header lays out beside the
  // title. Undo and redo stay inside History (Mitchell, 2026-10-09), and the
  // post-change toast still offers an undo. The `span` is what History's
  // popover hangs from on a phone.
  const overflowMenu = (
    <span className="inline-flex md:hidden">
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger>
          <Button ref={tripActions} variant="ghost" aria-label="Trip actions">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent
          onCloseAutoFocus={(event) => {
            const next = afterMenu.current;
            afterMenu.current = null;
            if (next === null) return;
            event.preventDefault();
            if (next === "add") openCreate();
            else if (next === "history") setHistoryOpen(true);
            else setSettingsOpen(true);
          }}
        >
          {/* `canEditBoard`, as the desktop's button: a suggester's stop joins their draft. */}
          {canEditBoard && <MenuItem onSelect={() => (afterMenu.current = "add")}>Add stop</MenuItem>}
          <MenuItem onSelect={() => (afterMenu.current = "history")}>History</MenuItem>
          <MenuItem onSelect={() => (afterMenu.current = "settings")}>Trip settings</MenuItem>
        </MenuContent>
      </Menu>
    </span>
  );

  return (
    <>
      <header
        ref={publishStickyStack}
        aria-label="Trip"
        // `.below-app-header` is the height of AppHeader, which is sticky at the
        // top and sits above this one on every `(app)` route: 56px plus the
        // device's top safe-area inset (globals.css, M39 D10). `/demo` draws
        // FrontDoorHeader instead, which does not stick — so there, offsetting by
        // AppHeader's height pins this header that far down and leaves a
        // see-through strip of scrolled content above it (Mitchell, preview
        // comment on `/demo`). Nothing is sticky above it there, so it pins to
        // the top, under the inset (`.pinned-at-top`).
        //
        // `z-20`, not `z-10`: a hovered or lifted river block is `z-10`
        // (RiverBlock.tsx — its tag reveal hangs out of it), and at equal z the
        // later element paints on top, so a block scrolled under this header
        // popped through it on hover (Mitchell, on the preview of pull request 257). Below AppHeader's
        // `z-30`; the phone tab bar's `z-20` never meets it.
        className={cn(
          "sticky z-20 border-b border-hairline bg-surface px-6 pt-3.5",
          // **One row on a phone** (M39 D6, KI-2026-09-24-i): back, title, Ask
          // and the overflow menu, about 56px, where the stacked header was
          // ~305px pinned. Every `max-md:` class below is that row; the
          // desktop classes beside them are untouched.
          "max-md:px-3 max-md:pt-1.5 max-md:pb-1.5",
          isDemoTripId(tripId) ? "pinned-at-top" : "below-app-header",
        )}
      >
        {/* On a phone the two columns and the nav row dissolve (`contents`)
            into this one flex row, and `order` puts Ask and the menu after the
            title. One tree for both widths, so nothing renders twice. */}
        <div className="flex flex-wrap items-start justify-between gap-3 max-md:flex-nowrap max-md:items-center max-md:gap-1">
          {/* `flex-auto` — `flex: 1 1 auto` — so this column absorbs the row's
              free space and the nav below can be a real full-width row with
              `‹ Trips` at one end and Ask at the other (SPEC §23). Deliberately
              NOT `flex-1`, which is `flex: 1 1 0%`: a zero flex-basis takes this
              column's content out of the wrap calculation entirely, so on a
              phone the title would be squeezed beside "Add stop"/History instead
              of the action cluster dropping to its own line as it does now.
              `auto` keeps the content-sized basis, so where the row wrapped
              before it still wraps. */}
          <div className="flex flex-auto flex-col gap-1 max-md:contents">
            {/* Both links go to `(app)` routes behind middleware, so on the
                demo board (`/demo`, ADR-031) — whose visitor has no session —
                each one is a trip to /signin. The whole nav row drops rather
                than the links being disabled: a disabled control still says
                "there is something here for you", and there is not, until they
                have an account. `DemoTripScreen` renders the front door's own
                header above this one, which is where a signed-out reader's way
                onward belongs. */}
            {!isDemoTripId(tripId) && (
              <nav className="flex w-full items-center justify-between gap-3 max-md:contents">
                {/* `min-h-11` and the inline-flex that makes it apply: §22 made
                    this link load-bearing on a phone. Scoping the tab bar removed
                    the Trips tab from inside a trip, so this is now the ONLY way
                    out of Plan and Map — and SPEC §13.1's "44px targets, always"
                    covers "every tag chip, nav item and row action". It was a
                    bare `text-xs` anchor with no height or padding, about 17px.
                    The type stays `text-xs`; §13.1 grows the box, never the font.
                    Raised by Copilot on PR #143. */}
                {/* An arrow alone on a phone, in a 44px box; the words stay in
                    the accessible name. */}
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center text-xs text-slate no-underline hover:text-ink max-md:min-w-11 max-md:shrink-0 max-md:justify-center max-md:text-base"
                >
                  ←<span className="max-md:sr-only"> Your trips</span>
                </Link>
                {/* The Notebook link that used to sit here is gone. It is now
                    the Notebooks menu (SPEC §11) in the view row below, which
                    `TripBoardScreen` renders as this header's child: a bordered
                    pill that also lists the trip's notebooks, instead of a plain
                    text link that read as a peer of "← Your trips" and could only
                    take you to the index. Notebook is still a separate route
                    subtree rather than a lens (design spec decision 11, refined
                    2026-07-20) — that part did not change; only the affordance
                    did. */}
                {/* SPEC §23: the phone's entry point to the assistant, LAST in
                    this row — "same pill, same label, same position, so it never
                    moves as you change tabs". The row's `justify-between` is what
                    pins it to the far end, so it stays there whatever the link
                    beside it is called.

                    §23 also moves the sync dot and avatar down to the title row,
                    and that half is deliberately not built: in this app neither
                    is in this row to begin with — the avatar lives in the global
                    `AppHeader`, a separate sticky bar this header sits under —
                    so honouring it would mean the phone dropping `AppHeader`
                    entirely, which is a change to every `(app)` route rather than
                    to this file. The row was already clear, so the pill just
                    goes in.

                    **At every width since M39 D3** (KI-2026-09-24-j). Above
                    768px the entry point was a fixed launcher bottom-right,
                    over the right-hand column's stop costs (SPEC §13.5,
                    "nothing floats over data"); it is this pill now, at the
                    end of the row `← Your trips` starts. That row is already
                    44px tall for the link, so the desktop header does not grow.
                    See `AskPill`. */}
                {/* The wrapper is only the phone row's `order`. */}
                {onOpenAssistant !== undefined && (
                  <span className="flex max-md:order-1">
                    <AskPill open={assistantOpen} onOpen={onOpenAssistant} />
                  </span>
                )}
              </nav>
            )}
            {/* The title IS the way into Trip settings, and the only way:
                Mitchell, preview feedback on PR #55 — "In the designs, removed
                the pencil, and made the trip title clickable to open the Trip
                edit display the cog currently opens, already remove the cog".
                Renaming therefore happens in that sheet's own "Trip name"
                field, which already existed; the inline Input this replaced is
                gone with the pencil.

                The accessible name deliberately carries BOTH — a bare
                aria-label="Trip settings" would announce the control and
                swallow the trip's name, and the trip name alone never says
                what the button does. Playwright's getByRole name matching is
                substring-and-case-insensitive, so the e2e specs that click
                { name: "Trip settings" } keep working against this. */}
            {/* `flex-wrap` and `gap-y-1`: on a phone the trip name plus its
                badges do not fit one line, and badges no longer wrap inside
                themselves (see Badge). They have to be able to wrap as whole
                items instead, or the row overflows — 2026-08-30 design pass. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 max-md:min-w-0 max-md:flex-1 max-md:flex-nowrap">
              {/* The button goes INSIDE the h2, not around it. The other way
                  round renders `<button><h2>…</h2></button>`, which is invalid
                  (a button's content model is phrasing content) and, worse,
                  silently costs the trip its heading: a button's descendants
                  are presentational in the accessibility tree, so the h2's role
                  is dropped and the name disappears from heading navigation
                  entirely. e2e caught it — m8-make-it-real asserts
                  getByRole("heading", { level: 2 }) on the trip name.

                  Nested this way both roles survive: h2 for structure, button
                  for the action. The type classes are restated on the button
                  because buttonVariants sets its own `font-medium` + size
                  `text-base`, which would otherwise shrink the title inside its
                  own heading. */}
              <Heading level={2} className="max-md:min-w-0">
                <Button
                  variant="ghost"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={`${activeTrip.name} — Trip settings`}
                  title="Trip settings"
                  className="h-auto justify-start p-0 text-left font-display text-xl font-semibold text-ink hover:bg-transparent hover:underline max-md:max-w-full"
                >
                  {/* One line on a phone, cut with an ellipsis; the full name
                      is in the button's accessible name and in Trip settings. */}
                  <span className="max-md:min-w-0 max-md:truncate">{activeTrip.name}</span>
                </Button>
              </Heading>
              {/* The phone's copy is on the line under the pinned row, where
                  it scrolls away (M39 D6, below). `max-md:hidden` covers the
                  one frame before `useIsPhone` has answered. */}
              {!isPhone && <span className="contents max-md:hidden">{identity}</span>}
            </div>
          </div>

          {/* Right side: the handoff action cluster (ghost Trip settings · ghost
              Share · primary Add stop), then the pre-existing sync/undo-redo/
              history cluster, then the BudgetChip underneath — a column so the
              outer row keeps its two-child justify-between split (info block vs.
              everything else) as it wraps at narrow widths. "Add a saved day"
              moved out of the header entirely (Task 1.4) — the design moved it
              into the plan flow; Phase 6 rebuilds it there. */}
          <div className="flex flex-col items-end gap-2 max-md:contents">
            {/* `sm:flex-nowrap`, not a bare flex-wrap removal: this row's own
                content (settings/share/add-stop + sync/undo/history) never
                needs more than ~433px, but a nested flex item's own content
                width isn't what decides whether the OUTER row (the
                title/right-cluster split above) wraps — that uses the right
                cluster's unwrapped intrinsic size, so this row can still get
                squeezed narrower than its content while staying on the
                outer row's first line, and its own `flex-wrap` would then
                split "settings/share/add stop" from "sync/undo/history"
                internally rather than the whole cluster dropping below the
                title (confirmed live by forcing this row's parent narrower
                than its content). `flex-wrap` stays as the floor below `sm`
                (640px) — comfortably above the ~480px this row's content
                needs — so genuinely narrow viewports keep the old two-line
                fallback instead of overflowing. */}
            <div className="flex flex-wrap items-center gap-4 sm:flex-nowrap max-md:contents">
              {/* Behind the overflow menu on a phone (M39 D6). */}
              <div className="flex flex-wrap items-center gap-2 max-md:hidden">
                {/* Handoff §2 action cluster: ghost "Share" · primary "Add stop".
                    Real as of M11 link 4 — ShareButton was an inert
                    <Preview id="share-button"> and is now a popover that mints,
                    copies and turns off pinned share links. It needs the tripId
                    it is sharing; everything else about this call site is
                    unchanged. */}
                {/* **Share is not in the header at all**, at any width.
                    Mitchell, 2026-09-06: *"Put share in the trip settings under
                    invite someone, both here and in mobile"*.

                    It was `hidden md:block` first — off the phone only, because
                    of an earlier report that these controls were "really crowded
                    and ugly on mobile". Desktop kept it on the reasoning that
                    there was room. Room is not the argument: sharing belongs with
                    the other answer to "who can see this trip", and having it in
                    two places meant a reader had to know which one this build
                    put it in.

                    `SettingsSheet` mounts the only `ShareButton` on a trip now,
                    under "Invite someone". The header keeps the actions that have
                    nowhere else to live — Add stop, History, undo/redo. */}
                {/* HIDDEN for a reader, not greyed (KI-64). This was the one
                    disabled control left on an otherwise quiet page: ADR-031 took
                    every other write affordance away from a read-only board —
                    card edit/remove, day remove, "+ Add", "One more day?",
                    conflict "Dismiss", the timeline's Ask/Edit/Add-stop/Keep-day,
                    the rack's day picker, Share, and undo/redo three blocks below
                    — on the stated grounds that "a disabled control still says
                    'there is something here for you'", and the header kept
                    saying it. The nav row eight blocks up already writes that
                    same sentence about itself.
                    ADR-031's closing section left this one deliberately, as the
                    argument for the other audience: for an INVITED viewer, a
                    greyed button says what promotion would buy them. That reading
                    needs the two audiences told apart — `readOnly` alone cannot,
                    it is one flag over a member without the rank AND a stranger
                    on /demo — and splitting it is the design decision that entry
                    names. Consistency now, per the rule already written down; the
                    split stays available if Trip settings → People wants it.
                    The "Viewer" badge is what still explains the quiet page. */}
                {/* `canEditBoard`: a suggester's new stop joins their draft. */}
                {canEditBoard && (
                  <Button variant="primary" onClick={() => openCreate()}>
                    Add stop
                  </Button>
                )}
              </div>

              {/* The trip's member names, for "Suggested by …" in the chip and
                  in History (W15). Not a new read: the access response
                  `TripProvider` already cached. */}
              <PeopleProvider tripId={tripId}>
                {/* On a phone this is the end of the row: Suggestions stays out
                    in it, since it only renders while someone has suggested
                    something and a count behind a menu is a count nobody sees,
                    and History moves into the overflow menu. */}
                <div className="flex items-center gap-0.5 max-md:order-2">
                  <span className="contents md:hidden">{conflicts?.(tripActions)}</span>
                  <SuggestionsChip />
                  {/* The Popover stays mounted during preview (not gated on
                      preview.seq === null like undo/redo/settings) — HistoryPanel's
                      "Viewing version N (read-only)" banner and its Revert/Back-to-now
                      controls must remain reachable while previewing a past state. */}
                  <Popover
                    open={historyOpen || preview.seq !== null}
                    // Hung from the overflow menu on a phone, where this
                    // popover's own button is not on screen.
                    anchor={isPhone ? overflowMenu : undefined}
                    onCloseAutoFocus={
                      isPhone
                        ? (event) => {
                            event.preventDefault();
                            tripActions.current?.focus();
                          }
                        : undefined
                    }
                    // #18: dismissing the popover (outside-click or Escape) while
                    // previewing a past state also exits the preview ("back to now"),
                    // so you never end up with a closed popover still pinned to an old
                    // version. The wider content gives the entries + preview controls
                    // room (#16/#17).
                    onOpenChange={(open) => {
                      setHistoryOpen(open);
                      if (!open && preview.seq !== null) preview.exit();
                    }}
                    align="end"
                    contentClassName="w-96"
                    trigger={
                      <Button variant="ghost" aria-label="History" className="max-md:hidden">
                        <Clock className="size-3.5" aria-hidden />
                        History
                      </Button>
                    }
                  >
                    {/* Undo/redo live here now, not out in the header row —
                        Mitchell, preview feedback on PR #55: "In the designs, the
                        next/previous history button was moved into the history
                        dropdown at the top". Hidden while previewing a past
                        version, same gate they had in the header: the panel's own
                        Revert / back-to-now controls are what act then. The ⌘Z
                        shortcut does NOT live with them (see
                        useUndoRedoShortcuts, called above) — popover content
                        unmounts when closed, and undo must keep working. */}
                    {preview.seq === null && !readOnly && (
                      <div className="mb-2 flex justify-end border-b border-hairline pb-2">
                        <UndoRedoControls
                          canUndo={history?.canUndo ?? false}
                          canRedo={history?.canRedo ?? false}
                          onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
                          onRedo={() => void dispatch({ type: "RedoChange", tripId })}
                          isBusy={pending}
                        />
                      </div>
                    )}
                    <HistoryPanel
                      history={history}
                      previewSeq={preview.seq}
                      readOnly={readOnly}
                      onPreview={(seq) => void preview.enter(seq)}
                      onExitPreview={preview.exit}
                      onRevert={(toSeq) => void dispatch({ type: "RevertToState", tripId, toSeq })}
                      // The demo trip is folded in memory and has no snapshot rows to ask for.
                      snapshots={isDemoTripId(tripId) ? undefined : { tripId, busy: pending, onRestored: applyOutcome }}
                    />
                  </Popover>
                  {!isPhone && overflowMenu}
                </div>
              </PeopleProvider>
            </div>
          </div>
        </div>

        {/* The meta pill and the budget chip are one row, not one-per-column:
            Mitchell, preview feedback on PR #55 — "The Budget card should be
            same height, and aligned with the left side Date / Days / Stops /
            cities Card". `items-stretch` is what makes them equal height (the
            budget chip is the taller of the two — it carries a progress bar
            under its amount — so the meta pill grows to meet it rather than
            either being pinned to a hardcoded height). This is also what the
            2026-08-24 design does: both sit in its `grid-row: 2`, spread by a
            justify-between. */}
        {/* Hidden below 768px, same breakpoint and same report as Share above:
            these two are the "trip overview to budget" half of "really crowded
            and ugly on mobile". They are the right things to cut first because
            they are pure INFORMATION — a phone loses a statement it can go and
            read, not an action it can no longer perform. What is kept beside the
            title is deliberately the opposite: "Add stop" and History are
            actions with no equivalent in Trip settings (History is a different
            surface entirely, and re-homing the primary write into a sheet would
            make adding a stop a three-tap operation on the device most likely to
            be adding one), and the tab bar is the phone's primary navigation.
            (M39 D6 then moved both into the phone's overflow menu: one tap
            more, for a pinned header a fifth of the height.)

            Nothing here becomes unreachable. Dates and budget were already
            editable in the sheet (its Dates row and TripMoneySettings); the day,
            stop and city counts are now stated there under "Trip overview".
            BudgetChip's no-budget state renders as a "Set a budget" button whose
            only job is to open that same sheet, and the trip title is still the
            door to it, so the one affordance that disappears on a phone is a
            second doorbell on the same door. */}
        <div data-testid="trip-meta-row" className="mt-2 hidden flex-wrap items-stretch justify-between gap-3 md:flex">
          {/* `dispatch` straight in, as SettingsSheet's `onCommand` below does:
              the pill's popover sends the same `SetTripStartDate` its Dates row
              does, and the provider's viewer gate still refuses it for anyone
              `readOnly` would have hidden it from. That gate knows nothing of
              history preview, though — `runDispatch` enqueues against the live
              trip — so the pill is text while an old seq is on screen, the same
              `preview.seq` gate undo/redo use. */}
          <TripMetaPill
            detail={activeTrip}
            readOnly={readOnly || preview.seq !== null}
            onCommand={(command) => void dispatch(command)}
          />
          <BudgetChip spend={tripSpend(activeTrip)} currency={activeTrip.currency} onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        {/* Handoff `current/…dc.html:249`: the tab strip lives INSIDE the sticky
            container, not after it. Before this it scrolled away while the header
            kept 147px of chrome pinned.

            The day-chips row used to sit here too, above the tabs. SPEC §35.3
            moved it into the Plan tab's body (TripBoardScreen) so that this
            header is the same height on every tab; with nothing above the tabs,
            this wrapper's 12px top and bottom are the design's `12px 26px 12px`
            on its own. On a phone the tabs are the tab bar's, so the padding
            goes and this holds only the tag-focus line, when there is one. */}
        {children !== undefined && <div className="flex flex-col gap-3 pt-3 pb-3 max-md:py-0">{children}</div>}
        {/* M39 D6: on a phone's Plan the day rail pins with the row above. */}
        {pinned}

        <SettingsSheet
          tripId={tripId}
          tripName={activeTrip.name}
          open={settingsOpen}
          onOpenChange={(open) => {
            setSettingsOpen(open);
            if (open) return;
            setSettingsAt(null);
            // Closing ends the link's instruction: the param goes, so a reload
            // or a copied URL does not reopen a sheet the reader closed. The
            // native call, which Next's router observes, keeps the view param.
            const { pathname, search, hash } = window.location;
            if (settingsSectionFrom(search) !== null) {
              window.history.replaceState(window.history.state, "", `${pathname}${withoutSettingsParam(search)}${hash}`);
            }
          }}
          scrollTo={settingsAt}
          startDate={activeTrip.startDate}
          endDate={activeTrip.days[activeTrip.days.length - 1]?.date ?? null}
          // The pill's own three figures, derived by the pill's own function
          // (TripMetaPill.tsx) — so what the sheet states below `md` and what
          // the pill states above it are the same numbers by construction, not
          // by two implementations agreeing.
          counts={tripCounts(activeTrip)}
          currency={activeTrip.currency}
          budget={activeTrip.budget}
          spend={tripSpend(activeTrip)}
          forkedFrom={activeTrip.forkedFrom}
          createdAt={activeTrip.createdAt}
          readOnly={readOnly}
          canEditBoard={canEditBoard}
          onInvitesChanged={noteInvites}
          access={access}
          onAccessChanged={refreshAccess}
          onCommand={(command) => {
            if (command.type !== "CreateTrip") void dispatch(command);
          }}
        />
      </header>
      {/* Under the pinned header, outside it: in the flow, so it covers
          nothing, and it scrolls away with the line below rather than adding
          a row to the pinned stack (`--sticky-stack-height` measures the
          header alone). */}
      <InstallNudge eligible={installNudge} />
      {/* **What scrolls away on a phone** (M39 D6): the trip's badges and its
          dates, on a line under the pinned row and outside the sticky box. */}
      {/* SPEC §23's date meta line: "the date range only. Stops and cities
          came out — the day rail and the trip below it already carry both."

          ADDITIVE here, not a trim, and Mitchell has seen and approved it
          as such. §23 is describing a meta line this build does not have on
          a phone: `trip-meta-row` below is `hidden … md:flex`, cut whole on
          his own report that the header was "really crowded and ugly on
          mobile" (see that row's comment). So the range is not being
          stripped of its counts — it is coming back on its own, which is
          exactly the shape §23 arrives at from the other direction.

          The date range and nothing else: no counts, no budget. Both are
          still a tap away in Trip settings, where hiding the pill put them.

          `tripDateRange` is the pill's own function, not a second one —
          `SettingsSheet`'s `datesLabel` is already a second copy of these
          rules and a third is where the header starts disagreeing with the
          sheet about the same trip. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 pt-2 md:hidden">
        {isPhone && identity}
        <div data-testid="trip-date-line">
          <DataText size="xs">{tripDateRange(activeTrip)}</DataText>
        </div>
      </div>
    </>
  );
}

// Three faces, then a count: enough to say "these people", few enough to sit
// beside a title.
const STACK_AVATARS = 3;

/**
 * The trip's travellers beside its title (travellers spec D10), and the door
 * to Trip settings → People. Travellers rather than everyone, so the faces
 * agree with the totals and with Home's cards (W17).
 *
 * `hidden sm:inline-flex`: below 640px the title row already wraps its badges
 * onto a second line, and one more item there would add a line to a header
 * Mitchell has already called crowded on a phone. The title still opens the same sheet.
 *
 * Nothing until the access read answers. The names live there, not on the
 * trip, and a stack of placeholder circles would say nothing.
 */
function TravellerStack({ access, onOpen }: { access: TripAccess | null; onOpen: () => void }) {
  if (access === null) return null;
  const going = new Set(travellerIds(access.members));
  const travellers = access.members.filter((m) => going.has(m.userId));
  if (travellers.length === 0) return null;
  const more = travellers.length - STACK_AVATARS;
  return (
    <Button
      variant="ghost"
      onClick={onOpen}
      aria-label="Travellers on this trip"
      title="Travellers on this trip"
      className="hidden h-8 px-1 sm:inline-flex"
    >
      {/* Its own row, so the overlap is not undone by the button's gap. */}
      <span className="flex">
        {travellers.slice(0, STACK_AVATARS).map((member, index) => (
          <PersonChip
            key={member.userId}
            name={displayNameFor(member)}
            avatar={member.avatar}
            color={member.color}
            size="md"
            ring
            className={cn(index > 0 && "-ml-2")}
          />
        ))}
      </span>
      {more > 0 ? <span className="text-xs font-semibold text-slate">+{more}</span> : null}
    </Button>
  );
}

/**
 * Publishes the height of the sticky stack this header ends — `AppHeader`'s
 * height above it where there is one (56px plus the top safe-area inset), plus
 * this header's own height — as
 * `--sticky-stack-height` on the document element, for the scroll margin on the
 * day-sync scroll targets (`.day-sync-target`, globals.css, KI-2026-09-13-a).
 *
 * `scrollIntoView` aligns with the scrollport's top edge and knows nothing
 * about what is pinned there, so a day header picked with the page scrolled
 * down landed under this header. The margin cannot be a constant: this header
 * wraps at narrow widths, carries the day rail on a phone's Plan (`pinned`),
 * and `AppHeader` is absent on `/demo`. So it is
 * measured — this header's resolved `top` (AppHeader's height, or the bare
 * inset on `/demo`: exactly the part of the stack above it) plus its own
 * height, re-read by a ResizeObserver whenever it wraps.
 *
 * A callback ref rather than `useRef` + effect because the header renders
 * `null` until the trip is ready, and an effect that ran first would find the
 * ref empty and never run again. The cleanup unpublishes the height, so a route
 * without this header does not inherit a margin for a stack that is not there.
 */
function useStickyStackHeight() {
  return useCallback((el: HTMLElement | null) => {
    if (el === null) return;
    const root = document.documentElement;
    const sync = () => {
      const top = parseFloat(getComputedStyle(el).top) || 0;
      root.style.setProperty("--sticky-stack-height", `${top + el.getBoundingClientRect().height}px`);
    };
    sync();
    // Feature-detected: jsdom ships no ResizeObserver (PhoneTabBar's guard).
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--sticky-stack-height");
    };
  }, []);
}
