"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { SavedDay } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";
import {
  deleteSavedDay,
  fetchPublicProfile,
  fetchSavedDay,
  publishSavedDay,
  unpublishSavedDay,
  type ApiResult,
} from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import { SEASON_LABELS, seasonOfMonth, type PublicAuthor } from "@/lib/playbooks";
import { dayLength, savedDayFacts, DAY_LENGTH_LABELS } from "@/lib/savedDayFacts";
import { toClockRange } from "@/lib/time";
import { backQuery } from "./backLink";
import { LibraryMoved, SyncFailure } from "./ReadStates";
import { useLibraryRead } from "./useLibraryRead";
import { AddToTripDialog } from "./AddToTripDialog";

// A shared day (M11b link 6). The full stop list with per-stop notes and city
// chips, an author strip, and a sticky rail of facts with "Add to a trip".
//
// **No rating, no 5→1 histogram, no review states.** §15 puts all three here;
// the 2026-08-30 scope decision puts them in M12 with the reviews table that
// would make them mean anything. Their absence is the milestone's, not an
// oversight — see "Explicitly not here".

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * The rail's season line: the bucket, and the month it was bucketed from.
 *
 * Both halves, because Mitchell asked for both (2026-09-01: *"Kept in → Season
 * ... but also should include month the first trip it was cloned from used"*).
 * The season is what Discover filters on and the month is the fact behind it,
 * so showing only the bucket would make the filter unexplainable and showing
 * only the month would leave the two surfaces speaking different languages.
 *
 * Exported and pure so the wording is asserted directly rather than through a
 * render, and so it cannot drift from `seasonOfMonth` — one lookup decides
 * which months are Fall, here and in the SQL alike.
 */
export function seasonLine(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "Not known";
  const month = at.getUTCMonth() + 1;
  const season = seasonOfMonth(month);
  const monthLabel = `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  return season === null ? monthLabel : `${SEASON_LABELS[season]} · ${monthLabel}`;
}

type DayView = { day: SavedDay; isAuthor: boolean; author: PublicAuthor };

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
    },
  };
}

export function SharedDayScreen({ savedDayId, backHref, backLabel }: { savedDayId: string; backHref: string; backLabel: string }) {
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
  const [busy, setBusy] = useState(false);
  // A refused publish used to clear `busy` and say nothing, so the button
  // simply did not move and the author had no way to tell a failure from a
  // no-op. Raised by review on pull request 102.
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();

  async function setVisibility(next: "public" | "private") {
    setBusy(true);
    setVisibilityError(null);
    const result = next === "public" ? await publishSavedDay(savedDayId) : await unpublishSavedDay(savedDayId);
    setBusy(false);
    // Re-read rather than patching local state from the response: the author
    // strip's numbers are computed server-side and a publish moves one of them.
    if (result.ok) {
      feed.reload();
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

  const { day, isAuthor, author } = feed.data;
  const facts = savedDayFacts(day.stops);
  const length = dayLength(facts.window);

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref} label={backLabel} />

      <SyncFailure read={feed} what="this day" />
      <LibraryMoved read={feed}>
        This day has changed since you opened it — its author published, withdrew or someone took it.
      </LibraryMoved>
      {withdrawn && (
        <Banner variant="warning" data-testid="day-withdrawn">
          That day is no longer in the library, so it could not be added. Its author took it back
          out while this page was open.
        </Banner>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Heading level={1}>{day.name}</Heading>
              {day.visibility === "private" && <Badge variant="neutral">Private</Badge>}
            </div>
            <Text variant="secondary" className="mt-1">
              Kept out of {day.sourceTripName}. Order and gaps kept, no dates — drop it into any
              trip and the times reflow around it.
            </Text>
          </div>

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
                {author.daysShared} day{author.daysShared === 1 ? "" : "s"} shared · added to{" "}
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
            <ol className="flex flex-col gap-2" data-testid="stop-list">
              {day.stops.map((stop, index) => (
                <Card as="li" key={index} className="flex flex-col gap-1.5 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-ink">{stop.title}</span>
                    {stop.timeWindow !== null && (
                      <DataText size="xs">{toClockRange(stop.timeWindow.start, stop.timeWindow.end)}</DataText>
                    )}
                  </div>
                  {stop.location?.city !== undefined && (
                    <span className="w-fit rounded-full bg-moss px-2.5 py-0.5 text-xs font-semibold text-slate">
                      {stop.location.city}
                    </span>
                  )}
                  {stop.notes !== null && stop.notes !== "" && (
                    <Text variant="secondary">{stop.notes}</Text>
                  )}
                  {stop.cost !== null && (
                    <DataText size="xs">{formatMoney(stop.cost.amountMinor, stop.cost.currency)}</DataText>
                  )}
                </Card>
              ))}
            </ol>
          )}
        </div>

        {/* The sticky rail: the facts, and the one action. */}
        <aside className="lg:w-72 lg:shrink-0">
          <Card raised className="flex flex-col gap-3 p-4 lg:sticky lg:top-6" data-testid="day-facts">
            <Fact label="Stops" value={String(facts.stopCount)} />
            <Fact
              label="Window"
              value={facts.window === null ? "No times set" : toClockRange(facts.window.start, facts.window.end)}
            />
            {/* Length, as its OWN row rather than appended to the Window value
                (Mitchell, 2026-09-01: "also add length, with a tag short medium
                long if the duration is <4h, 4-12h, 12h+" — said with the Window
                fact selected, so this is the elapsed span of that window).

                Two reasons for the extra row rather than "8:20 am – 8:30 pm ·
                Long" in one cell. At 411px the rail is full width and either
                fits, but the rail is `lg:w-72` on a desktop — 288px minus
                padding, where the label column plus a 17-character range plus a
                tag wraps the value onto a second line and the range stops
                reading as one thing. And a day with no times has no length at
                all (`dayLength` returns null): a separate row simply is not
                rendered, where a combined cell would need to suppress a
                dangling separator as well.

                Withheld entirely rather than shown as "—" for that untimed
                case, which is consistent with what `dayLength` refuses to do:
                a day that says nothing about when it runs must not be labelled
                "Short". The Window row above already says "No times set", so
                the rail is not silent about why. */}
            {length !== null && <Fact label="Length" value={DAY_LENGTH_LABELS[length]} />}
            {/* "Budget", not "Budget each" (Mitchell, 2026-09-01) — this rail
                is the only place that string was actually VISIBLE, since
                Discover's matching label is an aria-label over a select that
                shows its option instead. The per-person reading survives where
                it is attached to a number rather than to a heading: the
                Discover card still reads "$27.00 each". */}
            <Fact
              label="Budget"
              value={
                facts.budgetPerPerson === null
                  ? "Not priced"
                  : formatMoney(facts.budgetPerPerson.amountMinor, facts.budgetPerPerson.currency)
              }
            />
            {/* Season, over the month the day was lifted out of its source
                trip. `stopsForDay` drops a day's calendar date on purpose
                (ADR-029), so `created_at` is the only month a saved day
                carries — the label no longer claims otherwise, and Discover's
                filter buckets the same month through the same lookup. */}
            <Fact label="Season" value={seasonLine(day.createdAt)} />
            <Fact label="Added to" value={`${day.adds} trip${day.adds === 1 ? "" : "s"}`} />

            <Button
              variant="primary"
              className="mt-1 w-full justify-center"
              onClick={() => {
                setWithdrawn(false);
                setAdding(true);
              }}
            >
              Add to a trip
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
