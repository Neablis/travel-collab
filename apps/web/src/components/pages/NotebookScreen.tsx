"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PageContext, PageSummary } from "@tc/contracts";
import { createPage, deletePage, fetchPages, updatePage } from "@/lib/pagesClient";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { submitOnEnter } from "@/lib/submitOnEnter";

type Status = "loading" | "ready" | "error";

function describeBinding(context: PageContext): string {
  if (context.dayRef === undefined) return "Trip-wide";
  if (context.dayRef.kind === "index") return `Day ${context.dayRef.index + 1}`;
  return "Day binding";
}

function blankContext(tripId: string): PageContext {
  return { tripId };
}

// The Notebook list — a separate route subtree (design spec decision 11,
// refined 2026-07-20), not a lens tab. Fetches `listPages` on mount and
// renders create/rename/delete affordances entirely through `pagesClient`;
// each card links into the editor route (Task 4.4).
export function NotebookScreen({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pages, setPages] = useState<PageSummary[] | null>(null);
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
        setPages(result.value);
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

  const handleCreate = () => {
    setCreating(true);
    void createPage(tripId, {
      title: "Untitled page",
      context: blankContext(tripId),
      content: { type: "doc", content: [] },
    }).then((result) => {
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
      <div className="mb-4 flex items-center justify-between">
        <Heading level={2}>Notebook</Heading>
        <Button variant="primary" onClick={handleCreate} disabled={creating}>
          + New page
        </Button>
      </div>

      {error !== null && <p role="alert">{error}</p>}

      {pages.length === 0 ? (
        <EmptyState
          title="No pages yet"
          body="Create a page to start writing notes that stay in sync with your trip."
        />
      ) : (
        <ul className="flex flex-col gap-2">
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
                  <Text className="font-medium text-ink">{page.title}</Text>
                  <Text variant="secondary">
                    {describeBinding(page.context)} · Updated {new Date(page.updatedAt).toLocaleString()}
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
    </PageContainer>
  );
}
