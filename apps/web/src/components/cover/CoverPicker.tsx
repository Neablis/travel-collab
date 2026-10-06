"use client";

import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { UNSPLASH_HOME, unsplashCreditHref, type CoverCandidate, type TripCover } from "@tc/contracts";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage, coverSrc } from "@/components/cover/CoverImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import type { ApiError, ApiResult } from "@/lib/apiClient";
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
// the cover, and an EMPTY search, which the route answers without spending
// the quota, to learn whether covers are set up here at all — so the search
// row can be replaced before anyone types into it.

/**
 * The cover routes of whatever the picker is for, from `apiClient`:
 * `CoverSection` builds a trip's, `SharedDayScreen` a saved day's. Hold it
 * stable across renders: the picker reads again when it changes.
 */
export type CoverApi = {
  read(): Promise<ApiResult<TripCover | null>>;
  search(q: string, page: number): Promise<ApiResult<CoverCandidate[]>>;
  set(candidate: CoverCandidate): Promise<ApiResult<TripCover>>;
  clear(): Promise<ApiResult<null>>;
};

// The artboard's 3×2 grid. The route answers 12 a page, so one page is two
// screens of the grid, and "More results" asks Unsplash again only after both.
const GRID = 6;

const UNAVAILABLE = "Cover photos aren't available here yet.";

type Failure = "unavailable" | "quota" | "other";

function failureOf(error: ApiError): Failure {
  if (error.status === 503) return "unavailable";
  if (error.status === 429) return "quota";
  return "other";
}

const FAILURE_COPY: Record<Exclude<Failure, "unavailable">, string> = {
  quota: "That's a lot of photo searches for now. Give it a few minutes and try again.",
  other: "That didn't work. Try again.",
};

const LINK = "text-slate underline-offset-2 hover:text-brand-pressed hover:underline";

/**
 * The cover, with its credit, and — for whoever may change it — a search of
 * Unsplash to pick one from and a way to remove it. Anyone else sees the
 * cover and its credit, read-only. `canEdit` is advisory: the routes refuse
 * everyone else regardless. `onChange` hears each cover a pick or a removal
 * leaves; `heading={false}` leaves the visible title to a dialog around it.
 */
export function CoverPicker({
  api,
  canEdit,
  onChange,
  heading = true,
}: {
  api: CoverApi;
  canEdit: boolean;
  onChange?: (cover: TripCover | null) => void;
  heading?: boolean;
}) {
  const headingId = useId();
  // `undefined` until the first read lands; `null` is "no cover".
  const [cover, setCover] = useState<TripCover | null | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
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
  const [failure, setFailure] = useState<Exclude<Failure, "unavailable"> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.read().then((result) => {
      if (cancelled) return;
      // A failed read shows no cover rather than a broken one; picking still works.
      setCover(result.ok ? result.value : null);
    });
    if (canEdit) {
      void api.search("", 1).then((result) => {
        if (!cancelled && !result.ok && failureOf(result.error) === "unavailable") setUnavailable(true);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [api, canEdit]);

  /** Records a failed call: "unavailable" replaces the search row; the rest say so in a line. */
  function fail(error: ApiError) {
    const kind = failureOf(error);
    if (kind === "unavailable") setUnavailable(true);
    else setFailure(kind);
  }

  async function readPage(q: string, page: number): Promise<CoverCandidate[] | null> {
    setSearching(true);
    setFailure(null);
    const result = await api.search(q, page);
    setSearching(false);
    if (!result.ok) {
      fail(result.error);
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
    setResults(page);
    setPagesRead(1);
    setStart(0);
    setExhausted(page.length === 0);
  }

  async function more() {
    if (searched === null) return;
    const next = start + GRID;
    if (next < results.length) {
      setStart(next);
      return;
    }
    const page = await readPage(searched, pagesRead + 1);
    if (page === null) return;
    if (page.length === 0) {
      setExhausted(true);
      return;
    }
    setResults([...results, ...page]);
    setPagesRead(pagesRead + 1);
    setStart(next);
  }

  async function pick(candidate: CoverCandidate) {
    setBusy(true);
    setFailure(null);
    const result = await api.set(candidate);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setCover(result.value);
    onChange?.(result.value);
  }

  async function remove() {
    setBusy(true);
    setFailure(null);
    const result = await api.clear();
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setCover(null);
    onChange?.(null);
  }

  const shown = results.slice(start, start + GRID);
  const hasMore = start + GRID < results.length || !exhausted;

  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : "Cover photo"}
      className="flex flex-col gap-3"
    >
      <div className={cn("flex items-center gap-3", heading ? "justify-between" : "justify-end empty:hidden")}>
        {heading && (
          <Text as="span" id={headingId} className="block text-xs font-semibold uppercase tracking-wider text-slate">
            Cover photo
          </Text>
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

      {cover === undefined ? (
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
                {FAILURE_COPY[failure]}
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
                        <Text as="span" variant="muted">
                          No more photos.
                        </Text>
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
        className={cn("flex min-h-11 items-center truncate text-xs md:min-h-0", LINK)}
      >
        <span className="truncate">{candidate.photographerName}</span>
      </a>
    </li>
  );
}
