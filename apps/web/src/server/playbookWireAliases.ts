import type { DiscoverResponse, LeaderboardResponse, PublicAuthor, PublicProfileResponse } from "@/lib/playbooks";

// DEPRECATED wire aliases — remove this file, and its three call sites in
// `app/api/playbooks/**/route.ts`, after the next production deploy.
//
// The 2026-09-25 overnight sweep renamed two fields on these responses:
// `PublicAuthor.daysShared` → `playbooksShared` (KI-2026-09-19-c) and
// `DiscoverResponse.sharedDayCount` → `sharedPlaybookCount` (KI-2026-09-25-a).
// A tab still running the bundle from before that deploy parses these bodies
// with the OLD zod schemas, where both old names are required — so without the
// old key Discover, the leaderboard, the profile and the shared-day author
// strip all go to their error state until the tab is reloaded.
//
// So for one release the server sends both names with the same value. The
// current schemas do not declare the old keys and `z.object` strips unknown
// keys, so the current client ignores them. Applied AFTER the route's
// `.parse(...)`, because that parse would strip them too.

/** The author with `daysShared` added, equal to `playbooksShared`. Deprecated. */
export function withDeprecatedAuthorAlias(author: PublicAuthor): PublicAuthor & { daysShared: number } {
  return { ...author, daysShared: author.playbooksShared };
}

/** The Discover body with `sharedDayCount` added, equal to `sharedPlaybookCount`. Deprecated. */
export function withDeprecatedDiscoverAlias(
  body: DiscoverResponse,
): DiscoverResponse & { sharedDayCount: number } {
  return { ...body, sharedDayCount: body.sharedPlaybookCount };
}

/** The leaderboard body with every author carrying `daysShared`. Deprecated. */
export function withDeprecatedLeaderboardAlias(body: LeaderboardResponse) {
  return { ...body, authors: body.authors.map(withDeprecatedAuthorAlias) };
}

/** The profile body with its author carrying `daysShared`. Deprecated. */
export function withDeprecatedProfileAlias(body: PublicProfileResponse) {
  return { ...body, author: withDeprecatedAuthorAlias(body.author) };
}
