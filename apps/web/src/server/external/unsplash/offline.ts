import type { CoverCandidate } from "@tc/contracts";
import { UpstreamError, type CoverPhotos } from "./ports";

// The cover source every automated lane uses (`EXTERNAL_DATA_OFFLINE=true`):
// no automated test may call a real third party (Mitchell's policy), and the
// e2e server sets that flag beside `AI_LIVE: "false"`.
//
// Its images are SVGs under `public/offline-covers/`, served from the app's
// own origin, so a spec renders a cover with no network and no CSP exception.
// Its credit links point at unsplash.com: they are links a person follows,
// not requests anything makes. Its download locations are never fetched — a
// pick is recorded in `pings` instead, which is what a test asserts — but it
// keeps the port's promises as the real adapter does: it refuses a location
// it did not mint, and owns a candidate only as it served it, credit included,
// so a forged pick goes red offline too.

const photo = (id: string, name: string, alt: string | null, by: string, handle: string): CoverCandidate => {
  const raw = `/offline-covers/${name}.svg`;
  return {
    id,
    urls: { raw, regular: `${raw}?w=1080`, small: `${raw}?w=400` },
    alt,
    photographerName: by,
    photographerUrl: `https://unsplash.com/@${handle}`,
    photoPageUrl: `https://unsplash.com/photos/${id}`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download?offline=1`,
  };
};

const PHOTOS: readonly CoverCandidate[] = [
  photo("offline-dunes", "dunes", "Sand dunes under a pale sun", "Ada Offline", "ada-offline"),
  photo("offline-harbour", "harbour", "A harbour with a red boat", "Ben Offline", "ben-offline"),
  // No alt text, as some Unsplash photos have none: the UI's fallback is then
  // exercised offline too.
  photo("offline-ridge", "ridge", null, "Cy Offline", "cy-offline"),
];

/** The offline source, with every download it was asked to track, in order. */
export interface OfflineCoverPhotos extends CoverPhotos {
  readonly pings: string[];
}

/**
 * The offline cover source: the same three photos for any query on page 1,
 * none after it, and a ping log instead of a network call. One instance per
 * server process, so a route and the test that called it see the same log.
 */
export const offlineCoverPhotos: OfflineCoverPhotos = {
  pings: [],

  async search(_query, page) {
    return page === 1 ? PHOTOS.map((p) => structuredClone(p)) : [];
  },

  async trackDownload(downloadLocation) {
    if (!PHOTOS.some((p) => p.downloadLocation === downloadLocation)) {
      throw new UpstreamError("offline covers: refusing a download location this source did not mint");
    }
    this.pings.push(downloadLocation);
  },

  // Field for field: every photo it serves is fixed, so anything but an exact
  // copy of one — another name in the credit included — was not served.
  owns(candidate) {
    const own = PHOTOS.find((p) => p.id === candidate.id);
    return (
      own !== undefined &&
      own.downloadLocation === candidate.downloadLocation &&
      own.urls.raw === candidate.urls.raw &&
      own.urls.regular === candidate.urls.regular &&
      own.urls.small === candidate.urls.small &&
      own.alt === candidate.alt &&
      own.photographerName === candidate.photographerName &&
      own.photographerUrl === candidate.photographerUrl &&
      own.photoPageUrl === candidate.photoPageUrl
    );
  },
};
