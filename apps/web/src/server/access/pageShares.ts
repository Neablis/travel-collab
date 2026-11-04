import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { TODAY_SEED_KEY } from "@tc/pages";
import type { Page, PageShare, TripDetail } from "@tc/contracts";
import { db } from "../db/client";
import { pageShares, tripSummaries } from "../db/schema";
import { isUuid } from "../ids";
import { getPage } from "../pages";
import { getTripDetail } from "../projections";
import type { AccessResult } from "./invites";

// The same token as an invite or a pinned share (ADR-026, ADR-088 §1): 32 bytes
// of CSPRNG entropy, unique-indexed, stored as issued so an editor can re-copy it.
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

type ShareRow = typeof pageShares.$inferSelect;

/** The one place a stored instant becomes a `PageShare`'s string (KI-53). */
function toDto(row: ShareRow): PageShare {
  return {
    shareId: row.id,
    tripId: row.tripId,
    pageId: row.pageId,
    token: row.token,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  };
}

/**
 * Seeded notebooks made of widgets a stranger is never shown (M58 decision 4):
 * *Bookings & confirmations*, *Money*, and *During the trip*, which is the
 * `today` seed (M52). Matched on the key, which survives a rename.
 */
const UNPUBLISHABLE_SEEDS: ReadonlySet<string> = new Set(["bookings-and-confirmations", "money", TODAY_SEED_KEY]);

export function isPublishable(page: { seedKey?: string | null | undefined }): boolean {
  return page.seedKey == null || !UNPUBLISHABLE_SEEDS.has(page.seedKey);
}

const notFound = (): { ok: false; error: { code: "not-found"; message: string } } => ({
  ok: false,
  error: { code: "not-found", message: "This link does not exist." },
});

/**
 * Make a page public. A page that already has a live link is answered with that
 * link rather than a second one: `page_shares_page_live` is unique, so even two
 * simultaneous requests leave one token out.
 * After a revoke there is no live row, so this mints a new row and a new token:
 * a revoked token never comes back (ADR-088 §1).
 */
export async function createPageShare(
  tripId: string,
  pageId: string,
  createdBy: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<PageShare>> {
  const page = isUuid(pageId) ? await getPage(pageId) : null;
  if (page === null || page.tripId !== tripId) {
    return { ok: false, error: { code: "not-found", message: "This page does not exist." } };
  }
  if (!isPublishable(page)) {
    return { ok: false, error: { code: "invalid", message: "This notebook can't be made public." } };
  }
  const row: ShareRow = {
    id: randomUUID(),
    pageId,
    tripId,
    token: mintToken(),
    createdBy,
    createdAt: new Date(now),
    revokedAt: null,
  };
  // One transaction holding the trip's row: a DeleteTrip projection updates that
  // row before it revokes the trip's links, so it waits for this insert and then
  // revokes it. A status check outside would leave a live link on a deleted trip
  // that a restore would revive.
  return db.transaction(async (tx): Promise<AccessResult<PageShare>> => {
    const [trip] = await tx
      .select({ status: tripSummaries.status })
      .from(tripSummaries)
      .where(eq(tripSummaries.tripId, tripId))
      .for("share");
    if (trip === undefined || trip.status === "deleted") {
      // A link minted on a deleted trip would be revoked by nothing, and a restore would make it live.
      return { ok: false, error: { code: "invalid", message: "This trip has been deleted." } };
    }
    // The unique live-row index decides a race: the loser inserts nothing and
    // answers with the winner's link. That link can be revoked before it is
    // read, so a miss tries again rather than answering a row never stored.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [inserted] = await tx.insert(pageShares).values(row).onConflictDoNothing().returning();
      if (inserted !== undefined) return { ok: true, value: toDto(inserted) };
      const [live] = await tx
        .select()
        .from(pageShares)
        .where(and(eq(pageShares.pageId, pageId), isNull(pageShares.revokedAt)));
      if (live !== undefined) return { ok: true, value: toDto(live) };
    }
    return { ok: false, error: { code: "invalid", message: "This link changed while it was being made. Try again." } };
  });
}

/** A page's links, newest first. Revoked rows stay: the Share panel is the group's audit of what was public. */
export async function listPageShares(tripId: string, pageId?: string): Promise<PageShare[]> {
  if (pageId !== undefined && !isUuid(pageId)) return [];
  const rows = await db
    .select()
    .from(pageShares)
    .where(pageId === undefined ? eq(pageShares.tripId, tripId) : and(eq(pageShares.tripId, tripId), eq(pageShares.pageId, pageId)));
  return rows
    .map(toDto)
    // The id breaks a same-millisecond tie, so the v1 cursor can pick up exactly where a page ended.
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.shareId < b.shareId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

export async function revokePageShare(
  tripId: string,
  pageId: string,
  shareId: string,
  now: string = new Date().toISOString(),
): Promise<AccessResult<PageShare>> {
  // A non-uuid id would be `22P02` out of the driver, a 500 (KI-2026-09-05-x).
  if (!isUuid(shareId) || !isUuid(pageId)) return notFound();
  const [row] = await db
    .select()
    .from(pageShares)
    .where(and(eq(pageShares.id, shareId), eq(pageShares.pageId, pageId), eq(pageShares.tripId, tripId)));
  if (row === undefined) return notFound();
  // Idempotent: a double-click is a success, and keeps the first revoke's instant.
  if (row.revokedAt !== null) return { ok: true, value: toDto(row) };
  // Conditional, so of two simultaneous revokes only one writes; the other
  // re-reads the winner's instant rather than reporting its own.
  const [revoked] = await db
    .update(pageShares)
    .set({ revokedAt: new Date(now) })
    .where(and(eq(pageShares.id, shareId), isNull(pageShares.revokedAt)))
    .returning();
  if (revoked !== undefined) return { ok: true, value: toDto(revoked) };
  const [stored] = await db.select().from(pageShares).where(eq(pageShares.id, shareId));
  return stored === undefined ? notFound() : { ok: true, value: toDto(stored) };
}

/**
 * The public read's gate: token -> the live page and its trip, or why not. No
 * session, by design. Unknown, revoked, a deleted page and a deleted trip all
 * answer `not-found` with the same message, so the 404 names nothing
 * (ADR-088 §3). It reads the page as it is now, not a pin.
 */
export async function readPageShare(
  token: string,
): Promise<AccessResult<{ share: PageShare; page: Page; trip: TripDetail }>> {
  const gone: AccessResult<never> = { ok: false, error: { code: "not-found", message: "This link is not valid." } };
  const [row] = await db.select().from(pageShares).where(eq(pageShares.token, token));
  if (row === undefined || row.revokedAt !== null) return gone;
  const [page, trip] = await Promise.all([getPage(row.pageId), getTripDetail(row.tripId)]);
  if (page === null || page.tripId !== row.tripId || trip === null || trip.status === "deleted") return gone;
  return { ok: true, value: { share: toDto(row), page, trip } };
}

/**
 * The trip's live links as a lookup by page id, which is what link resolution
 * for a public reader takes as `publicTokenFor` (`WidgetContext`). A revoked
 * link is absent, so a link to a notebook that went private becomes plain text.
 */
export async function liveShareTokensFor(tripId: string): Promise<(pageId: string) => string | null> {
  const rows = await db
    .select({ pageId: pageShares.pageId, token: pageShares.token })
    .from(pageShares)
    .where(and(eq(pageShares.tripId, tripId), isNull(pageShares.revokedAt)));
  const byPage = new Map(rows.map((r) => [r.pageId, r.token]));
  return (pageId) => byPage.get(pageId) ?? null;
}
