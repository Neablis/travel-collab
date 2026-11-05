"use client";
import { useEffect, useState } from "react";
import type { PageShare } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  createPageShare,
  fetchPageShares,
  fetchPublishPreview,
  revokePageShare,
  type PublishPreview,
} from "@/lib/pagesClient";
import { publicNotebookLink } from "@/lib/publicNotebookLink";
import { PublicPageDoc } from "./editor/ReadOnlyPageDoc";

/**
 * *Make public* (M58 decisions 1 and 5): what a stranger would be shown, before
 * it is live. The preview is the server's public view, drawn here and never
 * worked out in the browser from the member's data; the plain-text list is the
 * titles of the notebooks the page links to that a stranger will see as words,
 * and each *Also make public* box starts unticked, because nothing becomes
 * public through a link that nobody ticked.
 *
 * Afterwards it is the link, with *Copy link* and *Make private*. The server
 * answers a publish of an already-public page with its existing link rather
 * than minting a second, so that answer is shown as it is.
 */
export function MakePublicDialog({
  tripId,
  pageId,
  title,
  open,
  onOpenChange,
  onChange,
}: {
  tripId: string;
  pageId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page's live token after a publish, or `null` after *Make private*: the screen's *Public* chip follows it. */
  onChange: (token: string | null) => void;
}) {
  const [live, setLive] = useState<PageShare | null>(null);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // On every open: the page may have been made public, or private, by someone
  // else since this was last shown. A live link is read first, since it needs no preview.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCopied(false);
    setTicked(new Set());
    setPreview(null);
    void (async () => {
      const shares = await fetchPageShares(tripId, pageId);
      const existing = shares.ok ? (shares.value.find((s) => s.revokedAt === null) ?? null) : null;
      if (cancelled) return;
      setLive(existing);
      if (existing === null) {
        const read = await fetchPublishPreview(tripId, pageId);
        if (cancelled) return;
        if (read.ok) setPreview(read.value);
        else setError(read.error.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tripId, pageId]);

  // Each notebook that landed is public whatever happens next, so a later
  // failure names them and stops offering them, rather than leaving them ticked
  // as if still to do.
  function failAfter(landed: readonly string[], message: string) {
    if (landed.length === 0) {
      setError(message);
      return;
    }
    const names = (preview?.alsoPublic ?? []).filter((o) => landed.includes(o.pageId)).map((o) => o.title);
    setPreview((prev) => (prev === null ? prev : { ...prev, alsoPublic: prev.alsoPublic.filter((o) => !landed.includes(o.pageId)) }));
    setTicked((prev) => new Set([...prev].filter((id) => !landed.includes(id))));
    setError(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} now public. ${message}`);
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      // The ticked notebooks first, so the page's links to them work the moment it is live.
      const landed: string[] = [];
      for (const id of ticked) {
        const side = await createPageShare(tripId, id);
        if (!side.ok) {
          failAfter(landed, side.error.message);
          return;
        }
        landed.push(id);
      }
      const made = await createPageShare(tripId, pageId);
      if (!made.ok) {
        failAfter(landed, made.error.message);
        return;
      }
      setLive(made.value);
      onChange(made.value.token);
    } finally {
      setBusy(false);
    }
  }

  async function makePrivate(share: PageShare) {
    setBusy(true);
    setError(null);
    try {
      const result = await revokePageShare(tripId, pageId, share.shareId);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setLive(null);
      onChange(null);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(publicNotebookLink(token));
      setCopied(true);
    } catch {
      // The link is in the box above, selected for the taking.
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={live === null ? `Make “${title}” public` : `“${title}” is public`}>
      <div className="flex flex-col gap-3">
        {loading ? (
          <SkeletonRegion label="Loading what a stranger will see" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-24 w-full" delay={2} />
          </SkeletonRegion>
        ) : null}

        {!loading && live !== null ? (
          <>
            <Text variant="secondary">Anyone with this link can read the notebook, without an account.</Text>
            <Input readOnly aria-label="Public link" value={publicNotebookLink(live.token)} onFocus={(e) => e.target.select()} />
            <div role="status" className="sr-only">
              {copied ? "Link copied." : ""}
            </div>
          </>
        ) : null}

        {!loading && live === null && preview !== null ? (
          <>
            <Text variant="secondary">
              Anyone with the link will be able to read this notebook, without an account. This is what they will see.
            </Text>
            <section
              aria-label="What a stranger sees"
              className="max-h-72 overflow-y-auto rounded-md border border-hairline bg-paper p-3"
            >
              <PublicPageDoc doc={preview.view} />
            </section>
            {preview.plainText.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Heading level={3} className="text-sm font-semibold">
                  Shown as plain text
                </Heading>
                <Text variant="muted">These are not public, so a stranger reads their names and cannot open them.</Text>
                <ul aria-label="Shown as plain text" className="list-disc pl-5 text-sm text-ink">
                  {preview.plainText.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.alsoPublic.length > 0 ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-semibold text-ink">Also make public</legend>
                {preview.alsoPublic.map((option) => (
                  <CheckboxField
                    key={option.pageId}
                    title={option.title}
                    checked={ticked.has(option.pageId)}
                    onCheckedChange={(on) =>
                      setTicked((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(option.pageId);
                        else next.delete(option.pageId);
                        return next;
                      })
                    }
                  />
                ))}
              </fieldset>
            ) : null}
          </>
        ) : null}

        {error !== null ? (
          <Text as="span" role="alert" className="text-xs text-danger-ink">
            {error}
          </Text>
        ) : null}
      </div>
      <DialogFooter>
        {live !== null ? (
          <>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void makePrivate(live)}>
              Make private
            </Button>
            <Button type="button" variant="primary" onClick={() => void copy(live.token)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={busy || loading || preview === null} onClick={() => void publish()}>
              Make public
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
