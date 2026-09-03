"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_TEMPLATES, type TemplateSeed } from "@tc/pages";
import type { PageContent, PageContext, PageSummary } from "@tc/contracts";
import { createPage, deletePage, fetchPages, updatePage } from "@/lib/pagesClient";
import { provenanceLabel, scopeLabel } from "@/lib/pageScope";
import { formatRelativeInstant } from "@/lib/formatDate";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { submitOnEnter } from "@/lib/submitOnEnter";

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
  build(tripId: string): { title: string; context: PageContext; content: PageContent };
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
  build: (tripId) => ({ title: BLANK_TITLE, context: { tripId }, content: { type: "doc", content: [] } }),
};

const STARTERS: Starter[] = [...DEFAULT_TEMPLATES.map(starterFrom), BLANK_STARTER];

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
  // Who is reading, so the provenance line can say "Yours" without guessing.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPages(tripId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPages(result.value.pages);
        setViewerId(result.value.viewerId);
        setStatus("ready");
      } else {
        setError(result.error.message);
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (status === "loading") return <PageContainer>Loading…</PageContainer>;
  if (status === "error" || pages === null) {
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

  return (
    <PageContainer>
      <div className="mb-6">
        <Heading level={2}>Notebooks</Heading>
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
                      {/* The scope as a Badge, not as secondary text. It was
                          already computed and already rendered — as the first
                          half of an "Trip-wide · Updated <full locale string>"
                          line — which is why two planning docs recorded it as
                          computed-but-unrendered. What was missing is that a
                          scope is a property of the notebook, and the design
                          gives properties badges so they can be scanned down a
                          column rather than read one row at a time. */}
                      <Badge variant="neutral">{scopeLabel(page.context)}</Badge>
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
    </PageContainer>
  );
}
