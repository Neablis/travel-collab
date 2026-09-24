// The Fetch spec caps the bodies of all in-flight `keepalive` requests at
// 64 KiB, and one over the cap is REJECTED rather than sent. A notebook can be
// bigger than that, so a larger one goes as an ordinary request, which still
// reaches the server on a client-side navigation and is only at risk on unload.
//
// Its own module rather than an export of `pagesClient`, whose every export is
// a network helper and is held to that by its totality witness.
const KEEPALIVE_BODY_LIMIT = 60_000;

/**
 * Whether a JSON body can be sent with `keepalive`. When it cannot, a write
 * sent from `pagehide` may never arrive, and `PageScreen` keeps the document in
 * the browser instead of trusting it to (`pageDraft.ts`).
 */
export function fitsKeepalive(body: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(body)).length <= KEEPALIVE_BODY_LIMIT;
}
