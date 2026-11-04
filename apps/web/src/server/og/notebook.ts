import { readPageShare } from "../access/pageShares";
import { getTripCover } from "../tripCovers";
import { PRODUCT_LINE, type CardCopy } from "./copy";

/**
 * What a public notebook's link-preview card prints, and nothing else
 * (M58 decision 2): the notebook's title and the trip's cover. No trip name,
 * no dates, no member and no publisher, because an unfurler draws this before
 * anyone has clicked.
 */
export type NotebookCard = { kind: "notebook"; title: string; cover: string | null } | { kind: "generic" };

/**
 * The card for `token`: the live notebook's, or the generic one for anything
 * else. Revoked, unknown and deleted are one answer, so the card names nothing
 * the 404 does not (ADR-088 §3). Never cached here: a revoked link must stop
 * showing its title on the next request.
 */
export async function notebookCardFor(token: string): Promise<NotebookCard> {
  const read = await readPageShare(token);
  if (!read.ok) return { kind: "generic" };
  return { kind: "notebook", title: read.value.page.title, cover: await coverImageOf(read.value.trip.tripId) };
}

// The picture the card draws, fetched by the card renderer from the photo
// host. Only a photo on https: a URL cover is served through our own proxy
// (ADR-081) and is left off the card rather than fetched around it.
async function coverImageOf(tripId: string): Promise<string | null> {
  const cover = await getTripCover(tripId);
  if (cover === null || cover.source !== "unsplash") return null;
  return cover.urls.regular.startsWith("https://") ? cover.urls.regular : null;
}

/** The notebook card's words. Pure. */
export function notebookCopy(card: NotebookCard): CardCopy {
  const label = "Caesura · notebook";
  if (card.kind === "generic") return { label, title: "A notebook on Caesura", description: PRODUCT_LINE };
  return { label, title: card.title, description: "Shared from Caesura" };
}
