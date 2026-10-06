import type { CoverCandidate } from "@tc/contracts";

export { UpstreamError } from "../upstream";

// The cover-photo seam (M37 D2), the weather ports' shape: a server-internal
// interface per capability, each adapter hiding its vendor and returning
// `CoverCandidate`s, never a vendor payload. Two adapters: Unsplash itself
// (`unsplash.ts`) and the offline fake every automated lane uses
// (`offline.ts`); `index.ts` picks one.
//
// Built for trips first and playbook days next (plan, part 5): nothing here
// knows what a cover is for, so a saved day's routes reuse it as is.

/** Where cover photos come from. */
export interface CoverPhotos {
  /**
   * One page of landscape photos for `query`, `page` from 1. Throws
   * `UpstreamError` when the source does not answer usefully.
   */
  search(query: string, page: number): Promise<CoverCandidate[]>;
  /**
   * Unsplash's "trigger a download" (guideline 2): called once each time a
   * person picks a photo, never for a photo merely shown. Throws
   * `UpstreamError` on failure, and refuses a URL this source did not mint.
   */
  trackDownload(downloadLocation: string): Promise<void>;
  /**
   * Whether `candidate` could have come from this source's `search`: its
   * images on the source's CDN, its credit links on unsplash.com, its download
   * location on the source's API. A pick arrives from the browser, so it is
   * checked here before it is stored and shown to everyone on the trip.
   */
  owns(candidate: CoverCandidate): boolean;
}

/** Whether `url` parses as an https URL on exactly `host`. */
export function httpsOn(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === host;
  } catch {
    return false;
  }
}

/**
 * Both credit links on unsplash.com. Shared by the two adapters: the offline
 * fake's credits point at Unsplash too, because a credit is a link a person
 * follows, never a request the app makes.
 */
export function creditLinksOnUnsplash(candidate: CoverCandidate): boolean {
  return httpsOn(candidate.photographerUrl, "unsplash.com") && httpsOn(candidate.photoPageUrl, "unsplash.com");
}
