"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_TEMPLATES, type TemplateSeed } from "@tc/pages";
import { newPageDoc } from "@tc/contracts";
import type { PageContext, PageDoc, PageSummary, TripDetail } from "@tc/contracts";
import { createPage, deletePage, fetchPages, updatePage } from "@/lib/pagesClient";
import { fetchTripDetail, type ApiError } from "@/lib/apiClient";
import { provenanceLabel } from "@/lib/pageScope";
import { formatRelativeInstant } from "@/lib/formatDate";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { submitOnEnter } from "@/lib/submitOnEnter";
import { AskPill } from "@/components/assistant/AskPill";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { phoneAskContext } from "@/components/assistant/phoneAskContext";
import { useAskThread } from "@/components/assistant/useAskThread";

type Status = "loading" | "ready" | "error";

// A starter offered by the "Start from a template" gallery. The first two are
// `@tc/pages`'s existing seeds — the same `trip-overview` / `day-sheet` that
// `instantiateDefaults` already plants in every new trip — so the gallery is a
// second way to reach content that exists rather than a second definition of
// it. "Blank page" is `handleCreate` as it already behaved, given a name and a
// description so it reads as a peer of the other two instead of as a button
// wearing a different shape in a different corner.
interface Starter {
  key: string;
  title: string;
  description: string;
  build(tripId: string): { title: string; context: PageContext; content: PageDoc };
}

const BLANK_TITLE = "Untitled notebook";

const STARTER_DESCRIPTIONS: Record<string, string> = {
  "trip-overview": "The whole trip in one place — the why, the shape, the money.",
  "day-sheet": "One day, close up. Times, reservations, notes for the group.",
};

function starterFrom(seed: TemplateSeed): Starter {
  return {
    key: seed.key,
    title: seed.title,
    description: STARTER_DESCRIPTIONS[seed.key] ?? "",
    build: (tripId) => ({ title: seed.title, context: seed.buildContext(tripId), content: seed.content }),
  };
}

// "Blank notebook", where SPEC §7 writes "Blank page" and M14 link 6 quotes the
// build's existing "Untitled page". **This is a deliberate one-word deviation
// from §7, not an oversight**: §11 (2026-08-25, the later pass) sets the rule
// that this product says "notebook" everywhere a person reads, and §7 predates
// it — the M14 milestone file already records the build's "page" nouns as the
// defect §11 created. Applying §11 here and leaving §7's literal string in the
// other two cards would be the same inconsistency one level down.
//
// The two template cards below take their names from the seeds themselves
// rather than from §7's "Trip overview" / "One day", so that what you click and
// what you get agree, and so that a trip seeded before today does not list a
// "Trip Overview" under a gallery card called something else. Renaming the
// seeds is `templates.ts`'s to do, which is M14 link 6's file.
const BLANK_STARTER: Starter = {
  key: "blank",
  title: "Blank notebook",
  description: "Start from nothing and write your own.",
  build: (tripId) => ({ title: BLANK_TITLE, context: { tripId }, content: newPageDoc() }),
};

const STARTERS: Starter[] = [...DEFAULT_TEMPLATES.map(starterFrom), BLANK_STARTER];

// What the assistant says when a turn opened from this surface came back with
// a proposal.
//
// This screen's scope is the whole trip (no page is open), and a trip-scoped
// turn reaches the WRITE tools — so "move dinner to Tuesday" really does come
// back with a proposal here, unlike on a notebook page, whose tools only
// insert. What this screen does not have is the other half of the ghost path:
// approving reconciles authoritative server state onto the board, and only
// `TripBoardScreen` holds a board to reconcile onto (`AssistantRail`'s own note
// on `onApproveProposal`).
//
// It SAYS so rather than dropping the proposal on the floor, for the reason
// `PageScreen`'s `READING_REFUSAL` gives: attaching no proposal leaves an
// answer that promises a change and shows nothing, which reads as the
// assistant being broken rather than as this surface declining. The note names
// the way through, because a refusal without one is a dead end.
const PROPOSE_ON_THE_PLAN =
  "I drafted that change, but it can only be applied from the trip's plan — open Plan and ask again to put it in.";

// The Notebook index — SPEC §7's list half. A separate route subtree (design
// spec decision 11, refined 2026-07-20), reached from the Notebooks menu in the
// board's view row rather than from a lens tab.
//
// **The noun is "notebook", not "page"** (SPEC §11: one noun in all three
// places, and the menu that leads here says notebook). The contract type is
// still `PageSummary` and the route is still `/pages`; only what a person reads
// changed.
//
// What the design asks this list for, beyond the titles: each notebook's scope,
// where it came from, and how fresh it is — the three things that let you pick
// between two notebooks without opening both.
export function NotebookScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  // The trip itself, for the title block's meta line (SPEC §23: *"the Notebook
  // index gained a title block — 'Notebook' at title scale with the trip name
  // as its meta line… That is where the trip name lives now"*).
  //
  // **Required, not fail-soft**, which is a deliberate change to this screen's
  // failure modes. `PageScreen` — the sibling this list links into — already
  // treats `fetchTripDetail` as load-bearing and shows this same one-line
  // error, and both requests are gated by the same membership check, so a
  // pages-succeeded / trip-failed split is transient rather than a state worth
  // rendering. Two adjacent notebook screens answering "the trip did not load"
  // differently is the drift that costs more than the failure does.
  const [trip, setTrip] = useState<TripDetail | null>(null);
  // Who is reading, so the provenance line can say "Yours" without guessing.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchPages(tripId), fetchTripDetail(tripId)]).then(([pagesResult, tripResult]) => {
      if (cancelled) return;
      if (!pagesResult.ok) {
        setError(pagesResult.error.message);
        setStatus("error");
        return;
      }
      if (!tripResult.ok) {
        setError(tripResult.error.message);
        setStatus("error");
        return;
      }
      setPages(pagesResult.value.pages);
      setViewerId(pagesResult.value.viewerId);
      setTrip(tripResult.value);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // **SPEC §23's phone entry point, and this screen had none of it.** Plan, Map
  // and an open page all reached the assistant before today; the Notebook index
  // is the one surface where §23's *"no entry point at all"* was literally true
  // (KI-2026-09-05-aa has the audit). So the whole path lands here at once —
  // pill, open state, sheet, thread — shaped like `PageScreen`'s rather than as
  // a second pattern.
  //
  // The scope is the TRIP, because that is what this surface is showing: a list
  // of the trip's notebooks, with none of them open. §23's load-bearing claim
  // is that the pill inherits the surface's scope instead of inventing one, and
  // `phoneAskContext` is where that derivation lives — not here.
  const ask = useAskThread({
    tripId,
    scope: { kind: "trip" },
    // Identity, for the reason `PageScreen` gives: /ask's own refusals are
    // already the words a reader needs — the demo-trip 403's prose is
    // byte-identical to the board's rewrite of it, and the not-entitled one
    // carries the server's own reason. The board's `askErrorMessage` is private
    // to `TripBoardScreen`; a copy of it here would be a second place those two
    // strings live, which is worse than the strings themselves.
    errorMessage: (error: ApiError) => error.message,
    // `proposal` is the one event this surface has to answer for. Everything
    // else `useAskThread` already handles; a proposal it does not handle is
    // silently dropped, which is the failure `PROPOSE_ON_THE_PLAN` exists to
    // prevent. **Not a phone-only proposal path** (§23 forbids one, for the
    // same reason the widget framework has no second chip renderer) — it is
    // this surface saying it is not the one that lands changes.
    onEvent: (event, patchAnswer) => {
      if (event.type !== "proposal") return;
      patchAnswer((turn) => ({ ...turn, text: `${turn.text}\n\n${PROPOSE_ON_THE_PLAN}` }));
    },
  });
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Closing hangs up on the turn in flight, the same as `PageScreen`: the
  // thread lives on this screen, so unmounting the sheet cancels nothing on its
  // own and a still-streaming answer would keep running against the server
  // behind a surface the user has put away.
  const closeAssistant = () => {
    ask.cancel();
    setAssistantOpen(false);
  };

  if (status === "loading") return <PageContainer>Loading…</PageContainer>;
  if (status === "error" || pages === null || trip === null) {
    return (
      <PageContainer>
        <p role="alert">{error ?? "Something went wrong"}</p>
      </PageContainer>
    );
  }

  // One create path for all three starters, blank included — the previous
  // `handleCreate` was this with the blank starter's arguments inlined, and
  // keeping two would mean the gallery's Blank page and any other create could
  // drift on title or navigation.
  const handleCreate = (starter: Starter) => {
    setCreating(true);
    void createPage(tripId, starter.build(tripId)).then((result) => {
      setCreating(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPages((prev) => [...(prev ?? []), result.value]);
      router.push(`/trips/${tripId}/pages/${result.value.id}`);
    });
  };

  const startRename = (page: PageSummary) => {
    setRenamingId(page.id);
    setRenameValue(page.title);
  };

  const saveRename = (pageId: string) => {
    const title = renameValue.trim();
    if (title.length === 0) return;
    void updatePage(tripId, pageId, { title }).then((result) => {
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPages((prev) => (prev ?? []).map((p) => (p.id === pageId ? { ...p, title: result.value.title, updatedAt: result.value.updatedAt } : p)));
      setRenamingId(null);
    });
  };

  const handleDelete = (pageId: string) => {
    void deletePage(tripId, pageId).then((result) => {
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPages((prev) => (prev ?? []).filter((p) => p.id !== pageId));
    });
  };

  // `page: null` IS the index — it is the only thing separating this surface
  // from an open page, and it is what makes the sheet trip-scoped here and
  // page-scoped one route down. `focusedDay` is `null` because it is: the
  // `FocusProvider` is mounted on the board route, not this one, and there is
  // no day open on a list of notebooks to point at.
  const phoneAsk = phoneAskContext(trip, null, { tab: "notebook", page: null });

  return (
    <PageContainer>
      <div className="mb-6">
        {/* SPEC §22 asks for this by name. Once the phone tab bar became
            scoped — Plan / Map / Notebook inside a trip, with Trips and
            Playbooks only outside one — this surface lost the Trips tab it had
            been relying on to get out, and "would otherwise have been a dead
            end". The Plan and Map screens already carry `← Your trips` through
            `TripHeader`; the notebook index does not render that header, so it
            needs its own.

            Shown at every width rather than `md:hidden`: on a desktop it is a
            second way out beside the header's, which is redundant but harmless,
            and a link that appears only under a breakpoint is the kind of thing
            that goes stale unseen. Styled as `TripHeader`'s is, so the two read
            as the same affordance. */}
        {/* The top row, SPEC §23: the way out on the left, `Ask` last. Same
            position as on Plan and Map, which is the whole of §23's *"same
            pill, same label, same position, so it never moves as you change
            tabs"* — a pill that sits in the header on two screens and
            somewhere else on the third is the inconsistency it exists to end.
            `AskPill` hides itself above 768px, so this row is a bare link on a
            desktop exactly as it was. */}
        <div className="mb-2 flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center text-xs text-slate no-underline hover:text-ink">
            ← Your trips
          </Link>
          <AskPill open={assistantOpen} onOpen={() => setAssistantOpen(true)} />
        </div>
        <Heading level={2}>Notebooks</Heading>
        {/* SPEC §23's meta line: *"'Notebook' at title scale with the trip name
            as its meta line, matching Plan's rhythm. That is where the trip
            name lives now."* It is not decoration — with the tab bar scoped
            (§22) this screen no longer sits under a trip header of any kind, so
            without this the phone Notebook names no trip at all and a user with
            two trips open in two tabs cannot tell them apart.

            The heading above it stays "Notebooks", plural, where §23 writes
            "Notebook" singular. Deliberate: §23 is describing the tab's name,
            and the plural is what this list has been called since §7 — three
            e2e specs name it exactly (`m7-solo-delight`, `m14-notebook-widgets`
            both assert `heading name "Notebooks" exact level 2`). Renaming a
            heading the design did not ask to rename, to a word that also has to
            be right in the tab bar, is a change to make in the design's own
            terms rather than as a side effect of adding a meta line. */}
        <Text variant="secondary" className="mt-1">
          {trip.name}
        </Text>
        {/* The standfirst, VERBATIM from SPEC §7, including its two uses of
            "page" where §11's one-noun rule would say notebook. Deliberate: it
            is the design's own sentence, and paraphrasing the one line a
            reviewer can diff against the spec costs more than the
            inconsistency. §11 governs the nouns this build chooses — the pill,
            the headings, the gallery card — not a quoted standfirst. Raised by
            Copilot on PR #126 and answered rather than applied.

            It is doing a job the list cannot: a notebook that follows the plan
            looks exactly like a notebook that does not until something moves,
            so the promise has to be stated before the reader has any reason to
            believe it. */}
        <Text variant="secondary" className="mt-1 max-w-prose">
          Pages that read like a document and stay true to the plan. Move a day or a stop and every page here follows
          it.
        </Text>
      </div>

      {error !== null && <p role="alert">{error}</p>}

      <section aria-labelledby="start-from-a-template" className="mb-8">
        <Heading level={3} id="start-from-a-template">
          Start from a template
        </Heading>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {STARTERS.map((starter) => (
            <Card as="li" key={starter.key} className="flex flex-col gap-2">
              <Text className="font-medium text-ink">{starter.title}</Text>
              <Text variant="secondary" className="flex-1">
                {starter.description}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCreate(starter)}
                disabled={creating}
                // The starter's own title is in the accessible name because
                // three buttons all labelled "Use this" is three buttons a
                // screen-reader user cannot tell apart, and because the e2e
                // suite has to be able to name the one it means.
                aria-label={`Start from ${starter.title}`}
              >
                Use this
              </Button>
            </Card>
          ))}
        </ul>
      </section>

      {/* A titled region, not a bare list. Two things made this necessary
          rather than decorative: the gallery above is itself a list of named
          things, so an untitled second list left the page with two peers and no
          way — for a screen reader walking regions, or for a test naming one —
          to say which is which; and a template card and a notebook seeded FROM
          that template carry the same name by design ("Trip Overview" is both),
          so the name alone can never disambiguate them. */}
      <section aria-labelledby="your-notebooks">
        <Heading level={3} id="your-notebooks">
          Your notebooks
        </Heading>
        {pages.length === 0 ? (
          <EmptyState
            title="No notebooks yet"
            body="Start from a template above, or create a blank one and write your own."
          />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pages.map((page) => (
              <Card as="li" key={page.id} className="flex items-center justify-between gap-3">
                {renamingId === page.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    {/* Enter saves the rename, Escape abandons it — the two
                        keys an inline rename is expected to answer to, and
                        neither did (Mitchell, 2026-09-01). Escape is handled
                        here rather than through `submitOnEnter` because it is a
                        cancel, not a submit, and because stopping propagation
                        matters: this row can sit inside an overlay whose own
                        Escape would close the whole surface out from under a
                        half-typed name. */}
                    <Input
                      aria-label={`Rename ${page.title}`}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setRenamingId(null);
                          return;
                        }
                        submitOnEnter(() => saveRename(page.id))(event);
                      }}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => saveRename(page.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Link href={`/trips/${tripId}/pages/${page.id}`} className="flex-1">
                    <span className="flex items-center gap-2">
                      <Text as="span" className="font-medium text-ink">
                        {page.title}
                      </Text>
                    </span>
                    {/* Provenance and freshness, SPEC §7. The absolute timestamp
                        it replaces answered a question nobody asks of a notebook
                        ("at what second?") and buried the one they do ("is this
                        stale?") in a locale string that changes width per row. */}
                    <Text as="span" variant="secondary" className="mt-0.5 block">
                      {provenanceLabel(page, viewerId)} · edited {formatRelativeInstant(page.updatedAt) ?? "recently"}
                    </Text>
                  </Link>
                )}

                {renamingId !== page.id && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startRename(page)} aria-label={`Rename ${page.title}`}>
                      Rename
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(page.id)} aria-label={`Delete ${page.title}`}>
                      Delete
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </ul>
        )}
      </section>

      {/* **`presentation="sheet"` unconditionally, and no `useIsPhone` on this
          screen at all.** The only control that can set `assistantOpen` here is
          `AskPill`, which is `md:hidden` — so an open sheet is already proof of
          a phone-width viewport, and asking a hook what width we are at would
          be asking a question the open state has answered. That also settles
          the first-paint flash `AssistantRail`'s `presentation` note warns
          about: `useIsPhone` starts `false` and corrects in an effect, but the
          rail cannot mount before a tap, and a tap cannot land before effects
          have run. There is no frame in which the wrong presentation paints,
          because there is no frame in which anything paints.

          The consequence, stated so it is not mistaken for an omission: this
          screen still has NO desktop assistant. It never had one, §23 adds the
          phone's entry point and not a desktop one, and inventing a bubble here
          would be build ahead of design. */}
      {assistantOpen ? (
        <AssistantRail
          presentation="sheet"
          contextLine={phoneAsk.contextLine}
          scope={phoneAsk.scope}
          turns={ask.thread}
          suggestions={phoneAsk.quickAsks}
          emptyHint={phoneAsk.emptyHint}
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
