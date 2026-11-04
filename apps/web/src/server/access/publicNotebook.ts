import { parsePageDoc, type Page, type PageNode, type TripDetail } from "@tc/contracts";
import { isUuid } from "../ids";
import { getPage, listPageEntries } from "../pages";
import { getTripDetail } from "../projections";
import { buildTripGlobals } from "../tripGlobals";
import { isPublishable, liveShareTokensFor } from "./pageShares";
import { toPublicNotebookView, type PublicNotebookView } from "./publicView";

/**
 * A notebook as a stranger reads it, built from the trip and page as they are
 * now. The one place the public view's inputs are assembled: `/n/<token>` and
 * the publish dialog's preview both call it, so what the publisher is shown is
 * what the link will serve (M58 decision 5), never a second reading of it.
 */
export async function publicViewOf(trip: TripDetail, page: Page): Promise<PublicNotebookView> {
  const [publicTokenFor, notebooks] = await Promise.all([liveShareTokensFor(trip.tripId), listPageEntries(trip.tripId)]);
  const now = new Date();
  return toPublicNotebookView({
    trip,
    globals: buildTripGlobals(trip),
    page: { title: page.title, content: parsePageDoc(page.content), context: page.context },
    external: {
      // A stranger's page makes no call to a weather source on the group's
      // behalf (the trip's places would leave with it), so it reads as down.
      weather: { state: "failed" },
      notebooks: {
        state: "ready",
        value: {
          pages: notebooks.map((entry) => ({
            id: entry.id,
            seedKey: entry.seedKey ?? null,
            title: entry.title,
            firstLine: entry.preview?.firstLine ?? null,
            widgetCount: entry.preview?.widgetCount ?? 0,
          })),
        },
      },
    },
    publicTokenFor,
    // A stranger has no time zone to read the date in: the server's calendar
    // day, and no clock, so nothing is scoped to "now".
    today: now.toISOString().slice(0, 10),
    now: null,
  });
}

/** A notebook the publisher could tick as *Also make public*. */
export interface AlsoPublicOption {
  pageId: string;
  title: string;
}

/**
 * What the publish dialog shows before anything goes live (M58 decision 1):
 * the stranger's view, the targets that will read as plain text, and the
 * notebooks that could be made public so that those links work.
 */
export interface PublishPreview {
  view: PublicNotebookView;
  /** Each private target's title, once. A day or a tab reads as its own name. */
  plainText: string[];
  alsoPublic: AlsoPublicOption[];
}

const VIEW_NAMES = new Set(["Plan", "Calendar", "Map"]);

/** The `link.internal` params of a stored document that a stranger is shown, in order. */
function visibleInternalLinks(nodes: readonly PageNode[], into: Record<string, unknown>[] = []): Record<string, unknown>[] {
  for (const node of nodes) {
    if (node.type === "macro") {
      if (node.attrs.name === "link.internal" && node.attrs.hideWhenPublic !== true) into.push(node.attrs.params);
    } else if ("content" in node && Array.isArray(node.content)) {
      visibleInternalLinks(node.content as readonly PageNode[], into);
    }
  }
  return into;
}

/** `null` when the page is not in this trip. The caller has already checked the role. */
export async function publishPreviewFor(tripId: string, pageId: string): Promise<PublishPreview | null> {
  const page = isUuid(pageId) ? await getPage(pageId) : null;
  if (page === null || page.tripId !== tripId) return null;
  const trip = await getTripDetail(tripId);
  if (trip === null) return null;
  const [view, entries, publicTokenFor] = await Promise.all([
    publicViewOf(trip, page),
    listPageEntries(tripId),
    liveShareTokensFor(tripId),
  ]);

  const plain = new Set<string>();
  const also = new Map<string, AlsoPublicOption>();
  for (const params of visibleInternalLinks(parsePageDoc(page.content).content)) {
    const to = params.to as
      | { kind?: string; pageId?: string; seedKey?: string; view?: string; day?: { kind?: string; dayId?: string } }
      | undefined;
    if (to === undefined) continue;
    if (to.kind === "view" && typeof to.view === "string" && VIEW_NAMES.has(to.view)) {
      plain.add(to.view);
      continue;
    }
    if (to.kind === "day") {
      const index = to.day?.kind === "dayId" ? trip.days.findIndex((d) => d.dayId === to.day?.dayId) : -1;
      if (index >= 0) plain.add(`Day ${index + 1}`);
      continue;
    }
    const target = entries.find((e) => (to.kind === "notebook" ? e.id === to.pageId : to.kind === "seed" && e.seedKey === to.seedKey));
    if (target === undefined || target.id === pageId || publicTokenFor(target.id) !== null) continue;
    plain.add(target.title);
    // A seeded notebook that can never be public stays text; it is not offered.
    if (isPublishable(target)) also.set(target.id, { pageId: target.id, title: target.title });
  }
  return { view, plainText: [...plain], alsoPublic: [...also.values()] };
}
