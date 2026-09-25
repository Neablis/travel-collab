"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { SavedDay, SavedDayModeration, TimeFormat } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { SharedDayMap } from "./SharedDayMap";
import { mapPanel } from "./sharedDayFacts";
import { scopedGeometry } from "./sharedDayGeometry";
import { useDistanceUnit } from "@/components/account/PreferencesProvider";
import { AuthorKindBadge } from "./AuthorKindBadge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { TabStrip } from "@/components/ui/tab-strip";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/lib/formatMoney";
import {
  deleteSavedDay,
  fetchPublicProfile,
  fetchSavedDay,
  publishSavedDay,
  unpublishSavedDay,
  type ApiResult,
} from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import { type PublicAuthor } from "@/lib/playbooks";
import { dayLength, savedDayFacts, DAY_LENGTH_LABELS } from "@/lib/savedDayFacts";
import { toClockLabel, toClockRange } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { backQuery } from "./backLink";
import { LibraryMoved, SyncFailure } from "./ReadStates";
import { useLibraryRead } from "./useLibraryRead";
import { AddToTripDialog } from "./AddToTripDialog";
import { ReportAction } from "./ReportDialog";
import { ReviewRail } from "./ReviewRail";
import { ReviewConflictBanner, ReviewsSection } from "./ReviewsSection";
import { useDayReviews } from "./useDayReviews";

// A shared day (M11b link 6). The full stop list with per-stop notes and city
// chips, an author strip, and a sticky rail of facts with "Add to a trip".
//
// **The rating, the 5→1 histogram and the review states are M12's** (links 3,
// 4 and 6), and this screen only wires them: `useDayReviews` owns the state,
// `ReviewRail` heads the sticky rail, `ReviewsSection` sits under the stop list,
// `ReviewConflictBanner` sits with the other banners, and `ReportAction` is the
// quiet "Report" on the day and on each review. They read the reviews endpoint,
// never the day's own read, so posting a review does not re-read the day.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * The month the day was lifted out of its source trip.
 *
 * **The season BUCKET is gone from this line** (M26 link 2, SPEC §33.2). It
 * read "Fall · September 2026", and the bucket was there for one reason,
 * written into the comment it replaces: *"the season is what Discover filters
 * on and the month is the fact behind it, so showing only the bucket would make
 * the filter unexplainable"*. §33.2 cut that filter, so the bucket now explains
 * nothing — it is a classification this product no longer acts on anywhere.
 *
 * **The month stays, because it is the half Mitchell actually asked for**
 * (2026-09-01: *"Kept in → Season ... but also should include month the first
 * trip it was cloned from used"*). Dropping the whole fact would have taken a
 * thing he requested along with a thing nobody used, and "Season is gone from
 * the rail" is a statement about the word and the bucket, not about the date.
 *
 * Pure so the wording is asserted directly rather than through a render.
 */
export function keptInLine(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "Not known";
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * One day of a Playbook, with what the divider above it has to say.
 *
 * **Walked from `dayCount`, not from the stops** — and that is the one place
 * this build deliberately parts company with the design. The artboard derives
 * its day list from the stops (`s.dayStart`), so an empty interior day simply
 * does not appear: a three-day Playbook with a free middle renders "Day 1" then
 * "Day 3" and leaves the reader to infer why. ADR-048 decision 2 says a gap
 * **is** an empty day — a rest day somebody deliberately kept — so the build
 * names every day, including empty interior ones and a trailing one, which no
 * stop could ever have carried.
 *
 * `number` is the stop's place in the **whole Playbook**, so `All days` merges
 * rather than concatenating: day 2 starts at 5 when day 1 held four stops
 * (§33.1). Scoped to one day the list renumbers from 1, because the number
 * answers "where am I in what I am looking at" and what you are looking at is
 * one day.
 */
export type PlaybookDay = {
  /** 0-based, as `SavedStop.dayIndex` is. */
  dayIndex: number;
  stops: readonly (SavedDay["stops"][number] & { number: number })[];
  /** This day's own clock range, or null when nothing on it carries a time. */
  window: { start: string; end: string } | null;
};

export function playbookDays(day: Pick<SavedDay, "stops" | "dayCount">): readonly PlaybookDay[] {
  let running = 0;
  return Array.from({ length: Math.max(1, day.dayCount) }, (_, dayIndex) => {
    // A one-day Playbook's stops may carry `dayIndex: 0` or nothing meaningful;
    // `dayCount === 1` means every stop belongs to the only day there is.
    const own = day.dayCount > 1 ? day.stops.filter((s) => s.dayIndex === dayIndex) : [...day.stops];
    const stops = own.map((stop) => ({ ...stop, number: ++running }));
    return { dayIndex, stops, window: savedDayFacts(own, 1).window };
  });
}

/**
 * What the stop list is a list of (`dc.html:6875`). The one line above the
 * list that reads the day count — because it names what is being shown, and
 * "the day" over three days would be false.
 */
export function ledgerLabel(dayCount: number, scope: "all" | number): string {
  if (dayCount <= 1) return "The day, as they ran it";
  return scope === "all" ? `All ${dayCount} days, as they ran them` : `Day ${scope + 1}, as they ran it`;
}

/** `9:45 am – 6:30 pm · 4 stops`, or what is true instead. */
export function dayDividerLine(group: PlaybookDay, clock: TimeFormat): string {
  if (group.stops.length === 0) return "Rest day";
  const count = `${group.stops.length} stop${group.stops.length === 1 ? "" : "s"}`;
  return group.window === null
    ? count
    : `${toClockRange(group.window.start, group.window.end, clock)} · ${count}`;
}

type DayView = {
  day: SavedDay;
  isAuthor: boolean;
  author: PublicAuthor;
  pinning: boolean;
  publishedAt?: string | null;
  /** An operator hid it (KI-2026-09-23-i). Only ever non-null on the author's own read. */
  moderation: SavedDayModeration | null;
};

/**
 * How often, and how many times, the page reads again while the server is
 * placing the day's stops on its map (M27 link 10). One server pass is at most
 * `MAX_PIN_LOOKUPS_PER_READ` lookups at the vendor's two a second — about ten
 * seconds — and a long Playbook takes two passes, so eight reads four seconds
 * apart cover both with room to spare. Past that the frame stops waiting and
 * shows what there is: a vendor that never answers must not pulse forever.
 */
const PIN_REREAD_MS = 4_000;
const MAX_PIN_REREADS = 8;

/**
 * One read, two requests.
 *
 * The author strip's numbers come from the SAME endpoint the public profile
 * uses, rather than from a count computed here — which is what makes "days
 * shared / how often their days were added" say the same thing beside a day as
 * it does on the profile that day links to.
 */
async function readDay(savedDayId: string): Promise<ApiResult<DayView>> {
  const dayResult = await fetchSavedDay(savedDayId);
  if (!dayResult.ok) return dayResult;
  const authorResult = await fetchPublicProfile(dayResult.value.savedDay.ownerId);
  if (!authorResult.ok) return authorResult;
  return {
    ok: true,
    value: {
      day: dayResult.value.savedDay,
      isAuthor: dayResult.value.isAuthor,
      author: authorResult.value.author,
      pinning: dayResult.value.pinning,
      publishedAt: dayResult.value.publishedAt,
      moderation: dayResult.value.moderation ?? null,
    },
  };
}

export function SharedDayScreen({ savedDayId, backHref, backLabel }: { savedDayId: string; backHref: string; backLabel: string }) {
  const clock = useTimeFormat();
  const read = useCallback(() => readDay(savedDayId), [savedDayId]);
  // Visibility and the adds count are what somebody else can move under a
  // reader — the day's stops are a snapshot and never change after it is saved.
  const signature = useCallback(
    (value: DayView) => `${value.day.visibility}:${value.day.adds}`,
    [],
  );
  const feed = useLibraryRead(read, signature);

  const [adding, setAdding] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  // §33.1: **`All days` is the default and opening any Playbook resets to it.**
  // Keyed on `savedDayId` rather than reset in an effect: a key change
  // re-initialises the state for free, where an effect would run after a render
  // that had already shown the previous Playbook's Day 3.
  const [dayScope, setDayScope] = useState<"all" | number>("all");
  const [scopeFor, setScopeFor] = useState(savedDayId);
  if (scopeFor !== savedDayId) {
    setScopeFor(savedDayId);
    setDayScope("all");
  }
  const [busy, setBusy] = useState(false);
  // A refused publish used to clear `busy` and say nothing, so the button
  // simply did not move and the author had no way to tell a failure from a
  // no-op. Raised by review on pull request 102.
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();
  const unit = useDistanceUnit();
  // The day's `publishedAt` as this page read it: a review held offline sends
  // it back as `seenPublishedAt`, so a republish in between becomes §15's
  // conflict banner. `undefined` until the day has been read ("do not check").
  const reviews = useDayReviews(savedDayId, feed.data?.publishedAt);

  // Read again while the server is still pinning — silently, because the
  // stops gaining coordinates is not "the library moved" (the signature above
  // does not look at stops, and this is not somebody else's edit either).
  const [pinReads, setPinReads] = useState(0);
  const pinning = feed.data?.pinning === true && pinReads < MAX_PIN_REREADS;
  const { refreshWithoutComparing } = feed;
  useEffect(() => {
    if (!pinning) return;
    const timer = setTimeout(() => {
      setPinReads((n) => n + 1);
      refreshWithoutComparing();
    }, PIN_REREAD_MS);
    return () => clearTimeout(timer);
    // `feed.data` rather than the callback: a new answer is what restarts the
    // wait, and `refreshWithoutComparing` is a fresh closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinning, feed.data]);

  async function setVisibility(next: "public" | "private") {
    setBusy(true);
    setVisibilityError(null);
    const result = next === "public" ? await publishSavedDay(savedDayId) : await unpublishSavedDay(savedDayId);
    setBusy(false);
    // Re-read rather than patching local state from the response: the author
    // strip's numbers are computed server-side and a publish moves one of them.
    //
    // `refreshWithoutComparing`, not `reload` (KI-20260831). `visibility` is
    // half this screen's signature, so a plain reload answered a successful
    // publish with the external-change banner — "its author published, withdrew
    // or someone took it" — about the button the author had just pressed. This
    // read is the only one on the page whose difference the reader already
    // knows about, because they caused it.
    if (result.ok) {
      feed.refreshWithoutComparing();
      return;
    }
    setVisibilityError(
      next === "public" ? "That day could not be published." : "That day could not be withdrawn.",
    );
  }

  /**
   * Delete this day (Mitchell, 2026-09-01). Owner-only and unpublished-only,
   * both of which the server decides — this is the same shape `SettingsSheet`'s
   * delete-trip flow takes: call the API directly, not through any queue, and
   * leave the page on success.
   *
   * The dialog is closed on BOTH outcomes, and the failure is reported in the
   * rail rather than inside a dialog that has gone: a refusal here is almost
   * always "you published this since the page loaded", and the answer to it is
   * the Unpublish button four rows up, which the dialog was covering.
   *
   * `feed.reload()` on failure, so the rail catches up with whatever moved
   * underneath it — the same reason `setVisibility` re-reads instead of
   * patching local state.
   *
   * The comparing `reload()` here, where `setVisibility` uses the silent one:
   * a refused delete means the day is published and this page believed it was
   * private, which is somebody else's edit arriving — exactly what the banner
   * is for. `setVisibility`'s re-read is the author's own edit coming back.
   */
  async function handleDelete() {
    setBusy(true);
    setDeleteError(null);
    const result = await deleteSavedDay(savedDayId);
    setBusy(false);
    setConfirmingDelete(false);
    if (result.ok) {
      // Back to Discover, not to `backHref`: this day is what the previous page
      // was showing, and returning to a profile or a Discover result set that
      // still lists it would show the reader the thing they just deleted.
      router.push("/playbooks");
      return;
    }
    setDeleteError(
      result.error.code === "published"
        ? "That day is published. Unpublish it first, then delete it."
        : "That day could not be deleted.",
    );
    feed.reload();
  }

  // The day is gone — never yours, withdrawn by its author, or deleted. All
  // three are the same 404 by design (`saved-day-access.ts`: a private day and
  // a nonexistent one must be indistinguishable, so ids cannot be enumerated),
  // so the copy cannot claim to know which.
  if (feed.data === null && feed.error !== null && !feed.loading) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink href={backHref} label={backLabel} />
        <EmptyState
          title="This day is not in the library"
          body="It may never have been shared, or its author may have taken it back out."
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={feed.reload}>
                Try again
              </Button>
              <Link href="/playbooks">
                <Button variant="primary">Back to Discover</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (feed.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink href={backHref} label={backLabel} />
        <Card className="h-64 animate-pulse rounded-lg bg-moss" aria-hidden data-testid="shared-day-skeleton" />
      </div>
    );
  }

  const { day, isAuthor, author, moderation } = feed.data;
  const facts = savedDayFacts(day.stops, day.dayCount);
  const length = dayLength(facts.window);
  const groups = playbookDays(day);
  const visibleGroups = dayScope === "all" ? groups : groups.filter((g) => g.dayIndex === dayScope);
  // The leg lines under each stop, from the very geometry the map draws — so
  // "12 min walk" under stop 3 is the leg the map joins 3 to 4 with.
  const panel = mapPanel(scopedGeometry(groups, dayScope), unit);
  const scopedGroup = dayScope === "all" ? null : (visibleGroups[0] ?? null);

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref} label={backLabel} />

      <SyncFailure read={feed} what="this day" />
      <LibraryMoved read={feed}>
        This day has changed since you opened it — its author published, withdrew or someone took it.
      </LibraryMoved>
      <ReviewConflictBanner reviews={reviews} />
      {withdrawn && (
        <Banner variant="warning" data-testid="day-withdrawn">
          That day is no longer in the library, so it could not be added. Its author took it back
          out while this page was open.
        </Banner>
      )}
      {/* KI-2026-09-23-i. Author-only here as well as on the route: the note
          is addressed to them. "Publishing it again" is named because it is
          the obvious next move and it does nothing — moderation and visibility
          are independent (the schema's `moderatedAt` note). */}
      {isAuthor && moderation !== null && (
        <Banner variant="warning" data-testid="day-hidden">
          A moderator hid this day from the library. It is still yours, but nobody else can find or
          open it, and publishing it again will not bring it back.
          {moderation.moderationNote !== null && (
            <>
              {" "}
              Their note to you: “{moderation.moderationNote}”
            </>
          )}
        </Banner>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Heading level={1}>{day.name}</Heading>
              {day.visibility === "private" && <Badge variant="neutral">Private</Badge>}
              {/* Beside "Private" rather than in the author strip below: this is
                  the screen somebody reads before deciding to take the day into
                  their own trip, and "who wrote it" belongs with the title they
                  are deciding on, not three paragraphs down beside the
                  leaderboard numbers. */}
              <AuthorKindBadge authorKind={day.authorKind} />
            </div>
            {/* §33.1: **the title block always speaks for the whole Playbook**,
                so no number below it is stated twice. This line is why the rail
                no longer carries Days, Stops or Kept in — it owned three facts
                the title should have. */}
            {/* The clock range rides this line too, as the artboard's `meta`
                does (`dc.html:6872`) — and it is NOT gated on the day count.
                `facts.window` is null for a Playbook over one day (ADR-048
                decision 4: no single window spans a night), so the one line
                reads right for both without a branch of its own. It used to
                be a rail row shown only when `dayCount === 1`, which made the
                two kinds of Playbook lay out differently for no reason a
                reader could see (Mitchell, M27 link 10: "Multiday and single
                day playbooks should mostly look the same"). */}
            <DataText size="xs" className="mt-1.5 block text-slate" data-testid="playbook-meta">
              {[
                day.dayCount > 1 ? `${day.dayCount} days` : null,
                `${day.stops.length} stop${day.stops.length === 1 ? "" : "s"}`,
                facts.window !== null ? toClockRange(facts.window.start, facts.window.end, clock) : null,
                `kept in ${keptInLine(day.createdAt)}`,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </DataText>
            <Text variant="secondary" className="mt-1">
              Kept out of {day.sourceTripName}. Order and gaps kept, no dates — drop it into any
              trip and the times reflow around it.
            </Text>
          </div>

          {/* §33.1: **`All days · Day 1 · Day 2 …`, under the title block.**
              `All days` first and default; **no tab row at all for a one-day
              Playbook**, because a single tab is a label pretending to be a
              control (project rule 2).

              A `TabStrip` — the moss pill — and not link 2's `UnderlineTabs`.
              The distinction is §33.2's own: an underline says "you are on a
              different page of this thing", and these are views of ONE
              Playbook, which is what the pill is for. The design agrees; its
              artboard mounts `TabStrip` here. */}
          {day.dayCount > 1 && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-hairline pt-3.5">
              <TabStrip<string>
                aria-label="Which day of this Playbook"
                value={dayScope === "all" ? "all" : String(dayScope)}
                options={[
                  { value: "all", label: "All days" },
                  ...groups.map((g) => ({ value: String(g.dayIndex), label: `Day ${g.dayIndex + 1}` })),
                ]}
                onValueChange={(value) => setDayScope(value === "all" ? "all" : Number(value))}
              />
              {/* The scoped day's own range beside the tab that chose it
                  (`dc.html` `dayLine`). Nothing under `All days`: the title
                  line already speaks for the whole Playbook. */}
              {scopedGroup !== null && (
                <DataText size="xs" data-testid="day-scope-line">
                  {dayDividerLine(scopedGroup, clock)}
                </DataText>
              )}
            </div>
          )}

          {/* SPEC §16 — **a shared day is a map plus a list.** It was only ever
              the list until now; `sharedDayGeometry.ts` had been written for
              this and had no production consumer (Mitchell, preview walk,
              2026-09-20).

              It sits ABOVE the list and BELOW the day tabs on purpose: the
              tabs scope both surfaces at once, and a reader who taps `Day 2`
              expects the map to follow the list rather than the two to
              disagree. And above the author strip, where the artboard puts it
              (`dc.html:2718`): the route is what somebody opens a Playbook to
              judge, and who wrote it is the second question.

              **Mounted for every Playbook, one day or ten** — never behind a
              day-count check (Mitchell, M27 link 10: "Every playbook should
              have maps for instance, not just the multi day ones"; the
              SharedDayScreen test pins it). And its frame is always there,
              whatever it holds — a route, the cities, a loading ground while
              the server pins the stops, or "Nothing to map yet" — so nothing
              below it moves when the map arrives. */}
          <SharedDayMap savedDayId={savedDayId} days={groups} scope={dayScope} pinning={pinning} />

          {/* The author strip. One resolver for the name (M17's seam), and the
              two numbers beside it are the profile's own. */}
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid="author-strip">
            <div className="min-w-0">
              {/* "You" on your own day, rather than your own account id sitting
                  next to the Publish button (Mitchell, 2026-09-01: "Dont show
                  the UUID in the header bar where publish button is"). Somebody
                  ELSE's name still goes through `displayNameFor`, which is the
                  M17 seam — and which no longer hands back a raw identifier
                  either. This branch is not that fix; it is the better answer
                  for the one reader who does not need to be told their own
                  name. */}
              <Link
                href={`/playbooks/profile/${encodeURIComponent(author.userId)}${backQuery({ from: "day", day: day.savedDayId })}`}
                className="font-semibold text-ink hover:underline"
              >
                {isAuthor ? "You" : displayNameFor({ userId: author.userId })}
              </Link>
              <Text variant="secondary">
                {author.playbooksShared} playbook{author.playbooksShared === 1 ? "" : "s"} shared · added to{" "}
                {author.adds} trip{author.adds === 1 ? "" : "s"}
              </Text>
            </div>
            {isAuthor && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void setVisibility(day.visibility === "public" ? "private" : "public")}
              >
                {day.visibility === "public" ? "Unpublish" : "Publish"}
              </Button>
            )}
          </Card>

          {visibilityError !== null && (
            <Banner variant="danger" data-testid="visibility-failed">
              {visibilityError} Nothing changed — try again.
            </Banner>
          )}

          {day.stops.length === 0 ? (
            <EmptyState
              title="This day has nothing on it"
              body="Every stop has been removed since it was kept."
            />
          ) : (
            <div>
              {/* The ledger's label (`dc.html:6875`). The one string here that
                  reads the day count, because it names what is being listed. */}
              <DataText size="xs" className="block pb-2.5 text-2xs tracking-widest uppercase" data-testid="ledger-label">
                {ledgerLabel(day.dayCount, dayScope)}
              </DataText>
              <ol className="flex flex-col" data-testid="stop-list">
                {/* Scoped by the tab above: every day when `All days`, one day
                    otherwise. **`All days` MERGES rather than concatenating** —
                    one list, one running stop number — which is what the divider
                    rows and `PlaybookDay.number` are between them for. */}
                {visibleGroups.map((group) => (
                  <Fragment key={group.dayIndex}>
                    {/* A divider only in the rollup: scoped to one day the tab
                        already names it, and repeating that under it is project
                        rule 4. A one-day Playbook has no rollup to divide — the
                        divider is part of the day picker, the one thing a
                        one-day Playbook does not have. */}
                    {dayScope === "all" && day.dayCount > 1 && (
                      <li className="flex items-center gap-3 pt-4.5 pb-1 first:pt-0">
                        <Text as="span" className="font-display font-semibold text-ink">
                          Day {group.dayIndex + 1}
                        </Text>
                        <DataText size="xs" className="text-slate" data-testid="day-divider-line">
                          {dayDividerLine(group, clock)}
                        </DataText>
                        <span aria-hidden className="h-px flex-1 bg-hairline" />
                      </li>
                    )}
                    {group.stops.length === 0 && (
                      <li className="py-2">
                        <Text variant="secondary" className="text-sm">
                          Nothing planned — kept as a rest day.
                        </Text>
                      </li>
                    )}
                    {group.stops.map((stop, i) => {
                      const shown = dayScope === "all" ? stop.number : i + 1;
                      const gap = panel.gaps.get(shown);
                      return (
                        <li key={`${group.dayIndex}:${stop.number}`}>
                          {/* `dc.html:2751`: time | 24px pin | body. The pin is
                              the map's own numbered pin, so a row and its pin
                              read as the same thing. */}
                          <div className="flex gap-2.5 pt-2.5 pb-0.5 md:gap-3">
                            <DataText size="xs" className="w-15.5 shrink-0 pt-0.5 md:w-21.5">
                              {/* The START, as the artboard's column shows it:
                                  a full range wraps to two lines in 86px, and
                                  the next row's start already says when this
                                  one gives way. */}
                              {stop.timeWindow !== null ? toClockLabel(stop.timeWindow.start, clock) : ""}
                            </DataText>
                            {/* §33.1's continuous numbering. Scoped to one day
                                it restarts at 1 — see `playbookDays`. */}
                            <span
                              className="grid size-6 shrink-0 place-items-center rounded-full bg-brand font-mono text-2xs font-semibold text-surface"
                              data-testid="stop-number"
                            >
                              {shown}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-px">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-ink">{stop.title}</span>
                                {stop.location?.city !== undefined && (
                                  <span className="rounded-full bg-moss px-2.5 py-0.5 text-2xs text-slate">
                                    {stop.location.city}
                                  </span>
                                )}
                              </div>
                              {stop.notes !== null && stop.notes !== "" && (
                                <Text variant="secondary" className="text-sm text-pretty">
                                  {stop.notes}
                                </Text>
                              )}
                            </div>
                          </div>
                          {/* The leg to the next stop, from the same geometry
                              the map draws (`panel.gaps` was computed for this
                              line and never had a reader until now). */}
                          {gap !== undefined && (
                            <div
                              className="flex items-center gap-2.5 py-0.5 md:gap-3"
                              data-testid="stop-gap"
                            >
                              <span className="w-15.5 shrink-0 md:w-21.5" />
                              <span className="grid h-6 w-6 shrink-0 place-items-center">
                                <span className="h-6 border-l-2 border-hairline" />
                              </span>
                              <DataText size="xs" className="text-2xs">
                                {gap}
                              </DataText>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </Fragment>
                ))}
              </ol>
            </div>
          )}

          <ReviewsSection reviews={reviews} savedDayId={day.savedDayId} canReview={!isAuthor} />
        </div>

        {/* The sticky rail: the facts, and the one action. */}
        <aside className="lg:w-72 lg:shrink-0">
          <Card raised className="flex flex-col gap-3 p-4 lg:sticky lg:top-6" data-testid="day-facts">
            {/* The rating heads the rail, above the facts (`dc.html:2872`).
                Nothing until the reviews are read: "Unrated so far" before the
                answer arrives would be a claim the answer might contradict. */}
            {reviews.data !== null && (
              <div className="border-b border-hairline pb-3">
                <ReviewRail summary={reviews.data.summary} />
              </div>
            )}
            {/* **Days and Stops left this rail** (M26 link 3, §33.1): the
                title block states both for the whole Playbook, and stating them
                twice on one screen is project rule 4. M23 link 4's requirement
                — that this route say how many days it is about to move — is
                met by that line rather than dropped. */}
            {/* **No Window row, for any Playbook** (M27 link 10). It was here
                only when `dayCount === 1`, on the argument that a one-day
                Playbook had nowhere else to say its range. The title line now
                does, for every Playbook that HAS one range — the artboard's own
                `meta` (`dc.html:6872`) — so the rail no longer lays a one-day
                Playbook out differently from a three-day one.

                Length stays: its own row rather than appended to the range
                (Mitchell, 2026-09-01: "also add length, with a tag short medium
                long if the duration is <4h, 4-12h, 12h+"), because at the
                rail's `lg:w-72` a range plus a tag wraps and stops reading as
                one thing. It is withheld, not shown as "—", whenever
                `dayLength` has nothing to measure — a day with no times, or a
                sequence with no single window (ADR-048 decision 4) — because a
                day that says nothing about when it runs must not be labelled
                "Short". That is a fact about the data, not a day-count branch. */}
            {length !== null && <Fact label="Length" value={DAY_LENGTH_LABELS[length]} />}
            {/* "Budget", not "Budget each" (Mitchell, 2026-09-01) — this rail
                is the only place that string was actually VISIBLE, since
                Discover's matching label is an aria-label over a select that
                shows its option instead.

                The word stays "Budget" on purpose. That was Mitchell's own
                wording in this same review (*"Budget each → Should just say
                Budget"*), so it is not up for a tidy-up into "Cost" or
                "Total" here. What went is the per-person READING that the
                first pass left standing on the number: `facts.totalCost` is a
                plain sum of the day's priced stops, dividing by nothing, so
                every surface now shows it as the day's total and none of them
                says "each" (Mitchell, same day: *"just show total cost there,
                any per person logic and math should go into the future
                milestone around cost"*). Real per-head math is M19's —
                `docs/milestones/M19-cost-model.md`. */}
            <Fact
              label="Budget"
              value={
                facts.totalCost === null
                  ? "Not priced"
                  : formatMoney(facts.totalCost.amountMinor, facts.totalCost.currency)
              }
            />
            {/* **Kept in left this rail too** — it is the third part of the
                title block's line (`3 days · 12 stops · kept in August 2026`).
                `keptInLine` still owns the wording; only the mount point moved.
                The season bucket that used to lead it went with Discover's
                season filter (M26 link 2). */}
            <Fact label="Added to" value={`${day.adds} trip${day.adds === 1 ? "" : "s"}`} />

            <Button
              variant="primary"
              className="mt-1 w-full justify-center"
              onClick={() => {
                setWithdrawn(false);
                setAdding(true);
              }}
            >
              {/* §33.1: **`Add all N days to a trip`** — the count only
                  surfaced inside the dialog before, so the button that moves
                  three days said the same thing as the one that moves one. */}
              {day.dayCount > 1 ? `Add all ${day.dayCount} days to a trip` : "Add to a trip"}
            </Button>

            {/* Delete, owner-only (Mitchell, 2026-09-01: "add a button to
                delete a notebook activity you own"). The `Dialog` +
                `variant="destructive"` pair is the repo's one idiom for this —
                `SettingsSheet`'s delete-trip flow — rather than a second
                confirmation shape.

                **DISABLED with a reason for a published day, not withheld —
                and that is a deliberate departure from ADR-031's "hidden, not
                greyed".** ADR-031's rule is about a control the actor may
                never use: a viewer's "Add stop" is greyed forever, so it only
                ever says "there is something here for you" untruthfully, and
                hiding it is the honest answer. This is the opposite case.
                Delete IS this person's to use — the only thing standing
                between them and it is one click on the Unpublish button four
                rows up, in the same viewport. A control that vanished when
                they published would read as the feature being gone, and would
                say nothing about how to get it back; greyed with the reason
                attached is exactly the "says what promotion would buy them"
                reading ADR-031's closing section left open, with the argument
                against it (that `readOnly` cannot tell two audiences apart —
                TripHeader.tsx's KI-64 note) not applying here, because
                `isAuthor` and `visibility` say precisely who this reader is
                and what is blocking them.

                The reason is on `title` AND in a visible line below, because a
                `title` tooltip needs a hover and Mitchell filed this walking a
                411px phone, where there is none. */}
            {isAuthor && (
              <>
                <Button
                  variant="destructive"
                  className="w-full justify-center"
                  disabled={busy || day.visibility === "public"}
                  title={
                    day.visibility === "public" ? "Unpublish it first" : undefined
                  }
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete this day
                </Button>
                {day.visibility === "public" && (
                  <Text variant="muted" className="text-xs">
                    Unpublish it first — a day in the library cannot be deleted from here.
                  </Text>
                )}
                {deleteError !== null && (
                  <Banner variant="danger" data-testid="delete-failed">
                    {deleteError}
                  </Banner>
                )}
              </>
            )}
            {/* Not for the author: reporting your own day is refused (403
                `own-content`), so the control could only fail. */}
            {!isAuthor && (
              <div className="flex justify-end">
                <ReportAction target={{ kind: "saved_day", savedDayId: day.savedDayId }} name="this day" />
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* The confirmation. Its copy says the two things the request itself
          settled — the copies already taken stay taken ("it doesn't remove it
          from anyone, it just removes it here"), and this is not the undoable
          delete a trip gets, because there is no restore surface yet, only the
          column that makes one possible. Saying "you can undo this" here, the
          way SettingsSheet's dialog does, would be a promise nothing keeps. */}
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete} title="Delete this day">
        <Text variant="secondary">
          Delete &quot;{day.name}&quot; from your library? Anyone who already added it to a trip
          keeps their copy. This cannot be undone from here.
        </Text>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void handleDelete()}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>

      <AddToTripDialog
        open={adding}
        onOpenChange={setAdding}
        savedDayId={day.savedDayId}
        dayName={day.name}
        dayCount={day.dayCount}
        onConflict={() => {
          setWithdrawn(true);
          feed.reload();
        }}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Text as="span" variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
      <DataText size="xs">{value}</DataText>
    </div>
  );
}

/**
 * The contextual back link (§15: "the profile returns to day, board or Discover
 * depending on where you came from, because the same page is reachable three
 * ways"). The same argument applies to a shared day, which is reachable from
 * Discover and from a profile.
 */
function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="w-fit text-sm text-slate hover:underline">
      ← {label}
    </Link>
  );
}
