import { notFound } from "next/navigation";
import type { PlaybooksReader } from "@/lib/playbooksReader";

// The page half of `playbooksReader.ts`, apart because `proxy.ts` imports that
// one into the Edge runtime and has no use for `next/navigation`.

/** The params every library page is handed: its own segments, and `copy` when it is the cached copy. */
export type LibraryParams = { copy?: string };

/**
 * Which copy a page is rendering. The pages live once, in `app/playbooks/live`,
 * where Next hands them no `copy`. The cached copy is `app/playbooks/[copy]`,
 * whose pages are those same pages re-exported, so they arrive with the
 * segment `proxy.ts` wrote there: `cached`. Anything else is a 404 — a URL
 * that names a copy itself (`/playbooks/live/…`) arrives as
 * `/playbooks/live/live/…` or `/playbooks/cached/live/…` and misses.
 */
export async function readerOf(params: Promise<LibraryParams>): Promise<PlaybooksReader> {
  const { copy } = await params;
  if (copy === undefined) return "live";
  if (copy !== "cached") notFound();
  return "cached";
}

/**
 * The page's query string as a live page reads it, and none at all for the
 * cached copy: it renders in ISR mode, where reading `searchParams` fails the
 * render (ADR-077), and `proxy.ts` only sends a URL there when its query holds
 * nothing a page reads.
 */
export function queryFor<T extends object>(reader: PlaybooksReader, searchParams: Promise<T>): Promise<Partial<T>> {
  return reader === "live" ? searchParams : Promise.resolve({});
}

/** A route's props as the library hands them: its own segments, maybe `copy`, and its query. */
export type LibraryRoute<R extends { params: Promise<object>; searchParams: Promise<object> }> = {
  params: Promise<Awaited<R["params"]> & LibraryParams>;
  searchParams: R["searchParams"];
};

/** A library route's props with the query its copy may read (`queryFor`), for a helper that takes the route's own. */
export async function libraryProps<P extends LibraryParams, Q extends object>(props: {
  params: Promise<P>;
  searchParams: Promise<Q>;
}): Promise<{ params: Promise<P>; searchParams: Promise<Partial<Q>> }> {
  return { params: props.params, searchParams: queryFor(await readerOf(props.params), props.searchParams) };
}
