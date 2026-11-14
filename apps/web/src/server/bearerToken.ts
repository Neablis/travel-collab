// Its own file, not `public-api/actor`: Poppy's session gate reads the same header,
// and `public-api` already imports `poppy`, so living in `actor` made a folder cycle.

// **Case-insensitive, and the token is the non-space run.** RFC 7235 makes the
// auth-scheme case-insensitive, so `bearer tc_…` from a client that lowercases
// its headers is a real credential — and answering it as "anonymous" is the
// 401 an integrator cannot debug, because their token IS valid. `\S+` rather
// than `.+` also stops a trailing space or `\r` riding along into the digest,
// which would fail verification for a reason nothing in the response names.
const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/** The bearer token a request carries, or `null` when its `Authorization` is absent or not a bearer. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header === null ? null : (BEARER.exec(header)?.[1] ?? null);
}
