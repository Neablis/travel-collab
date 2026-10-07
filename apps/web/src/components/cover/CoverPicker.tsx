"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { UNSPLASH_HOME, unsplashCreditHref, type CoverCandidate, type TripCover } from "@tc/contracts";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage, coverSrc } from "@/components/cover/CoverImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { ApiResult, CoverRefusal, CoverResult } from "@/lib/apiClient";
import { cn } from "@/lib/cn";

// The cover picker (M37, the approved `CoverPicker` artboard): Trip settings
// → Cover photo (part 4), and a playbook day's *Add cover* (part 5). What it
// covers arrives as `api`, the four calls its routes answer, so the one picker
// serves both. A cover is not a command (D1), so it does its own reads and
// writes, the way `PeopleSection` does, and nothing goes through a dispatch.
//
// One purpose only — a cover for this trip or this day — so there is no feed,
// no download and no gallery (Unsplash's guidelines, plan rule 4). A search is
// spent only when a person presses Search (D2): opening the picker asks for
// the cover, and makes the free probe below.

/**
 * The cover routes of whatever the picker is for, from `apiClient`:
 * `CoverSection` builds a trip's, `SharedDayScreen` a saved day's. Hold it
 * stable across renders: the picker reads again when it changes.
 */
export type CoverApi = {
  read(): Promise<ApiResult<TripCover | null>>;
  search(q: string, page: number): Promise<CoverResult<CoverCandidate[]>>;
  set(candidate: CoverCandidate): Promise<CoverResult<TripCover>>;
  clear(): Promise<ApiResult<null>>;
};

// The artboard's 3×2 grid. The route answers 12 a page, so one page is two
// screens of the grid, and "More results" asks Unsplash again only after both.
const GRID = 6;
// The route's page size (`PER_PAGE` in the Unsplash adapter). A page shorter
// than this is the last: asking for the next one spends a search to learn
// there is nothing more (PR #353 review). The adapter drops a candidate it
// cannot credit, so a short page can, rarely, hide a further one — a photo
// missed is cheaper than a press that always spends quota.
const PAGE = 12;

const UNAVAILABLE = "Cover photos aren't available here yet.";

/** Which call failed: the copy differs, because the quotas do. */
type Call = "search" | "pick" | "remove";

type Failure = "unavailable" | "quota" | "upstream-limit" | "other";

function failureOf(error: CoverRefusal): Failure {
  // By the body, not the status alone: the rate limiter's own outage is a 503
  // too, and that is not "covers are not set up here".
  if (error.status === 503 && error.message === "covers-unavailable") return "unavailable";
  // Unsplash's own limit, which the search route passes on with when it ends;
  // our quota's 429 says who is over it instead.
  if (error.status === 429 && error.message === "covers-rate-limited") return "upstream-limit";
  if (error.status === 429) return "quota";
  return "other";
}

/** The line a failed call shows. */
function failureCopy(failure: Exclude<Failure, "unavailable">, call: Call, retryAfterSeconds?: number): string {
  if (failure === "upstream-limit") {
    const minutes = retryAfterSeconds === undefined ? null : Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return `Unsplash is taking no more searches from here for now. Try again in ${
      minutes === null ? "a few minutes" : `about ${minutes} minute${minutes === 1 ? "" : "s"}`
    }.`;
  }
  if (failure === "quota") {
    return call === "pick"
      ? "That's a lot of cover changes for now. Give it a few minutes and try again."
      : "That's a lot of photo searches for now. Give it a few minutes and try again.";
  }
  return "That didn't work. Try again.";
}

// The 44px phone floor on an inline link, released at `md` (§13.1, as the
// tiles' credits take it). Inline-flex so the link stays in its sentence.
const LINK = "inline-flex min-h-11 items-center text-slate underline-offset-2 hover:text-brand-pressed hover:underline md:min-h-0";

/**
 * The cover, with its credit, and — for whoever may change it — a search of
 * Unsplash to pick one from and a way to remove it. Anyone else sees the
 * cover and its credit, read-only. `canEdit` is advisory: the routes refuse
 * everyone else regardless. `initial` is a cover the page already holds,
 * which the picker then does not read again; `onChange` hears each cover a
 * pick or a removal leaves; `heading={false}` leaves the visible title to a
 * dialog around it.
 */
export function CoverPicker({
  api,
  canEdit,
  initial,
  onChange,
  heading = true,
  onSettled,
}: {
  api: CoverApi;
  canEdit: boolean;
  /** The cover as the page read it (`null` for none), or `undefined` for the picker to read. */
  initial?: TripCover | null;
  onChange?: (cover: TripCover | null) => void;
  heading?: boolean;
  /**
   * Called once, when the section's opening reads have landed and its height
   * has stopped changing — so a sheet opened at a section below it can land
   * there again (`SettingsSheet`).
   */
  onSettled?: () => void;
}) {
  const headingId = useId();
  // `undefined` until the first read lands; `null` is "no cover". A failed
  // read leaves it `undefined` and sets `readFailed`: not knowing is not "no
  // cover", and must not hide *Remove cover* from a cover that exists.
  const [cover, setCover] = useState<TripCover | null | undefined>(initial);
  // Only the first read is skipped for a known cover: *Try again* still reads.
  const [known] = useState(initial !== undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  // Whether the editor's opening probe has answered; a reader makes none.
  const [probed, setProbed] = useState(!canEdit);
  const [query, setQuery] = useState("");
  // The search the results are for, so "More results" continues it even if
  // the field has since been edited.
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<CoverCandidate[]>([]);
  const [pagesRead, setPagesRead] = useState(0);
  const [start, setStart] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const noMoreRef = useRef<HTMLSpanElement>(null);
  // Where focus goes once the control that had it is gone: *Remove cover*
  // and *More results* both unmount under the press that used them.
  const refocus = useRef<"after-remove" | "no-more" | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (known && readAttempt === 0) return;
    let cancelled = false;
    void api.read().then((result) => {
      if (cancelled) return;
      if (result.ok) setCover(result.value);
      else setReadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api, readAttempt, known]);

  // Covers are unavailable on a deployment with no Unsplash key. An empty
  // query is how to ask: the route answers it before the quota, so it spends
  // nothing, and a 503 replaces the search row before anyone types into it.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void api.search("", 1).then((result) => {
      if (cancelled) return;
      if (!result.ok && failureOf(result.error) === "unavailable") setUnavailable(true);
      setProbed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api, canEdit]);

  useEffect(() => {
    if (settled.current || !probed || (cover === undefined && !readFailed)) return;
    settled.current = true;
    onSettled?.();
  }, [probed, cover, readFailed, onSettled]);

  useEffect(() => {
    if (refocus.current === "no-more" && noMoreRef.current) {
      refocus.current = null;
      noMoreRef.current.focus();
    } else if (refocus.current === "after-remove" && cover === null) {
      refocus.current = null;
      (searchRef.current ?? headingRef.current ?? sectionRef.current)?.focus();
    }
  });

  /** Records a failed call: "unavailable" replaces the search row; the rest say so in a line. */
  function fail(error: CoverRefusal, call: Call) {
    const kind = failureOf(error);
    if (kind === "unavailable") setUnavailable(true);
    else setFailure(failureCopy(kind, call, error.retryAfterSeconds));
  }

  async function readPage(q: string, page: number): Promise<CoverCandidate[] | null> {
    setSearching(true);
    setFailure(null);
    const result = await api.search(q, page);
    setSearching(false);
    if (!result.ok) {
      fail(result.error, "search");
      return null;
    }
    return result.value;
  }

  async function search() {
    const q = query.trim();
    if (q === "") return;
    const page = await readPage(q, 1);
    if (page === null) return;
    setSearched(q);
    setResults(uniqueById([], page));
    setPagesRead(1);
    setStart(0);
    setExhausted(page.length < PAGE);
  }

  async function more() {
    if (searched === null) return;
    const next = start + GRID;
    if (next < results.length) {
      setStart(next);
      if (next + GRID >= results.length && exhausted) refocus.current = "no-more";
      return;
    }
    const page = await readPage(searched, pagesRead + 1);
    if (page === null) return;
    // Unsplash can repeat a photo across pages; one already shown would be a
    // duplicate React key and a tile offered twice.
    const fresh = uniqueById(results, page);
    const last = page.length < PAGE || fresh.length === 0;
    setExhausted(last);
    setPagesRead(pagesRead + 1);
    if (fresh.length === 0) {
      refocus.current = "no-more";
      return;
    }
    setResults([...results, ...fresh]);
    // From the first new photo, not `next`: a short screen before it (a page
    // of 11) would otherwise skip what fell between.
    setStart(results.length);
    if (last && fresh.length <= GRID) refocus.current = "no-more";
  }

  async function pick(candidate: CoverCandidate) {
    setBusy(true);
    setFailure(null);
    const result = await api.set(candidate);
    setBusy(false);
    if (!result.ok) return fail(result.error, "pick");
    setCover(result.value);
    setReadFailed(false);
    onChange?.(result.value);
  }

  async function remove() {
    setBusy(true);
    setFailure(null);
    const result = await api.clear();
    setBusy(false);
    if (!result.ok) return fail(result.error, "remove");
    refocus.current = "after-remove";
    setCover(null);
    onChange?.(null);
  }

  const shown = results.slice(start, start + GRID);
  const hasMore = start + GRID < results.length || !exhausted;

  return (
    <section
      ref={sectionRef}
      // Focusable only for the fallback above: with no heading of its own,
      // the section is what is left to land on.
      tabIndex={heading ? undefined : -1}
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : "Cover photo"}
      className="flex flex-col gap-3 outline-none"
    >
      <div className={cn("flex items-center gap-3", heading ? "justify-between" : "justify-end empty:hidden")}>
        {/* Focusable: where focus lands once *Remove cover* is gone and there is no search to land in. */}
        {heading && (
          <span
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="block text-xs font-semibold uppercase tracking-wider text-slate outline-none"
          >
            Cover photo
          </span>
        )}
        {canEdit && cover && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void remove()}
            className="font-semibold text-danger-ink hover:text-danger-ink"
          >
            Remove cover
          </Button>
        )}
      </div>

      {readFailed && cover === undefined ? (
        <div className="flex items-center justify-between gap-3">
          <Text variant="secondary">Couldn&apos;t load the cover photo.</Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setReadFailed(false);
              setReadAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : cover === undefined ? (
        <Skeleton className="h-33 w-full" />
      ) : cover !== null ? (
        <div className="flex flex-col gap-2">
          <CoverImage
            photo={cover}
            className="h-33 rounded-lg border border-hairline"
            sizes="(min-width: 768px) 472px, 100vw"
          />
          <CoverCredit photo={cover} />
        </div>
      ) : (
        !canEdit && <Text variant="secondary">No cover photo yet.</Text>
      )}

      {canEdit &&
        (unavailable ? (
          <p className="rounded-lg border border-hairline bg-moss px-3.5 py-3 text-sm text-slate">{UNAVAILABLE}</p>
        ) : (
          <>
            <form
              role="search"
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <Input
                ref={searchRef}
                aria-label="Search photos"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="Search photos, e.g. Kyoto autumn"
                maxLength={100}
              />
              <Button type="submit" variant="secondary" disabled={searching || query.trim() === ""}>
                Search
              </Button>
            </form>

            {failure !== null && (
              <p role="status" className="text-sm text-danger-ink">
                {failure}
              </p>
            )}

            {searching && shown.length === 0 ? (
              <div className="grid grid-cols-3 gap-2.5" aria-hidden>
                {Array.from({ length: GRID }, (_, i) => (
                  <Skeleton key={i} className="h-24 w-full" delay={((i % 3) + 1) as 1 | 2 | 3} />
                ))}
              </div>
            ) : (
              searched !== null && (
                <>
                  {results.length === 0 ? (
                    <Text variant="secondary">No photos found for &ldquo;{searched}&rdquo;.</Text>
                  ) : (
                    <ul className="grid grid-cols-3 gap-2.5" aria-label={`Photos for ${searched}`}>
                      {shown.map((candidate) => (
                        <ResultTile
                          key={candidate.id}
                          candidate={candidate}
                          selected={cover?.unsplashId === candidate.id}
                          disabled={busy}
                          onPick={() => void pick(candidate)}
                        />
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <Text as="span" variant="muted">
                      Photos from{" "}
                      <a href={unsplashCreditHref(UNSPLASH_HOME)} target="_blank" rel="noopener" className={LINK}>
                        Unsplash
                      </a>
                    </Text>
                    {results.length > 0 &&
                      (hasMore ? (
                        <Button variant="ghost" size="sm" disabled={searching} onClick={() => void more()} className="font-semibold text-ink">
                          More results
                        </Button>
                      ) : (
                        // Focusable so *More results*, gone under the press that
                        // emptied it, hands focus here rather than to the page.
                        <span ref={noMoreRef} tabIndex={-1} className="text-xs text-slate outline-none">
                          No more photos.
                        </span>
                      ))}
                  </div>
                </>
              )
            )}
          </>
        ))}
    </section>
  );
}

/**
 * One search result: the photo as a real toggle button, named for its
 * photographer, with their credit link beneath it. The current cover is
 * pressed and carries a check.
 */
function ResultTile({
  candidate,
  selected,
  disabled,
  onPick,
}: {
  candidate: CoverCandidate;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <Button
        variant="ghost"
        aria-label={`Use photo by ${candidate.photographerName}`}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onPick}
        className={cn(
          "relative h-24 w-full overflow-hidden rounded-lg bg-moss p-0",
          selected && "outline-3 outline-offset-2 outline-brand",
        )}
      >
        {/* The button's label names the photo; the image itself is decoration here. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from Unsplash's CDN by its guidelines (D3); next/image would proxy it */}
        <img
          src={coverSrc(candidate.urls.raw, 400)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
        {selected && (
          <span
            aria-hidden
            className="absolute top-1.5 right-1.5 grid size-5.5 place-items-center rounded-full bg-brand text-surface"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </Button>
      <a
        href={unsplashCreditHref(candidate.photographerUrl)}
        target="_blank"
        rel="noopener"
        className={cn("flex truncate text-xs", LINK)}
      >
        <span className="truncate">{candidate.photographerName}</span>
      </a>
    </li>
  );
}

/** `page`'s candidates that are not already in `seen`, nor repeated within `page`. */
function uniqueById(seen: CoverCandidate[], page: CoverCandidate[]): CoverCandidate[] {
  const ids = new Set(seen.map((c) => c.id));
  return page.filter((c) => !ids.has(c.id) && ids.add(c.id));
}
