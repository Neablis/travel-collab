// The MapLibre setup that every map on this site needs, in one place.
//
// This module exists because a second map was about to be written (the shared
// Playbook day, SPEC §16) and four of the lines below are not setup — they are
// bug fixes somebody already paid for, in ways that are invisible until they
// are missing:
//
//   1. `setWorkerUrl` before the first `Map` construction (bump #158). MapLibre
//      v6 resolves its tile-decoding worker from `import.meta.url`; after
//      bundling that is not an http(s) url, so it falls back to `new Worker("")`
//      — which resolves against the document, hands the browser this page's
//      HTML as a module script, and is refused on MIME type. The visible
//      symptom is map chrome drawn over a basemap that never decodes a tile.
//   2. A `ResizeObserver` calling `map.resize()`. MapLibre computes tile cover
//      from the container's size at one moment; read before layout settles it
//      concludes a 0×0 viewport needs zero tiles and never recovers on its own
//      (sources register, every `sourcedata` stays `isSourceLoaded: false`,
//      `load` never fires).
//   3. An `error` handler that tells a FATAL failure from a survivable one. A
//      single tile 404 or a missing sprite must not swap the canvas for an
//      offline panel; a style that never parsed means nothing will ever draw.
//   4. A blank placeholder for `styleimagemissing`, or MapLibre logs one
//      console error per unresolved sprite id.
//
// A from-scratch second map re-acquires all four. That is the whole argument
// for this file: it is not shared because it is similar, it is shared because
// the differences are bugs.

/**
 * The muted "positron" basemap, so day accents (routes, markers) are the only
 * colour on the map that carries meaning. The older "liberty" style's own
 * colourful landuse and POI fills competed with them.
 */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/**
 * Served by us, under MapLibre's original filenames, by
 * `scripts/copy-maplibre-worker.mjs` at build/dev start. Same-origin, so the
 * CSP's `worker-src 'self'` already covers it (next.config.ts). See note 1.
 */
export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/**
 * Is this MapLibre `error` event worth giving up on?
 *
 * Exported for its own test: the distinction is a judgement call that has been
 * got wrong in both directions, and it is much easier to assert against a pure
 * predicate than to provoke a real tile 404 in a test.
 */
export function isFatalMapError(event: unknown): boolean {
  const { error, sourceId } = (event ?? {}) as { error?: { message?: string }; sourceId?: string };
  const message = error?.message ?? "";
  // A sprite or image that did not resolve is handled by the placeholder in
  // `createBaseMap`, which draws a blank in the slot. This test runs FIRST and
  // wins over the source rule below on purpose: a sprite failure that also
  // names a source is still the placeholder's, not the offline panel's.
  if (/sprite|image/i.test(message)) return false;
  // Otherwise: a **style or source** failure counts, and nothing else does.
  // An unattributable error — no source, no mention of the style — is most
  // often a stray MapLibre warning, and blanking the canvas on one of those
  // would turn every warning into an outage.
  //
  // **A source-attributed error is fatal here even though a lone tile 404 is
  // survivable in principle.** That is this predicate's known coarseness, kept
  // deliberately: it is MapLens's shipped behaviour, and this module's job is
  // to carry that behaviour to a second map unchanged, not to retune it while
  // nobody is looking. Narrowing it is a real change with its own evidence —
  // it needs a reproduction of a corner-of-the-viewport 404 that proves the
  // map stays useful, which is exactly the case a test cannot stage today.
  if (sourceId === undefined && !/style/i.test(message)) return false;
  return true;
}

export type BaseMap = {
  map: import("maplibre-gl").Map;
  Marker: typeof import("maplibre-gl").Marker;
  LngLatBounds: typeof import("maplibre-gl").LngLatBounds;
};

/**
 * Create a map in `container` with every fix above already applied.
 *
 * Resolves to `null` when `cancelled()` goes true while the MapLibre chunk is
 * still loading — the caller's effect was torn down mid-import, and
 * constructing a map into a detached element leaks a WebGL context.
 *
 * The returned `dispose` removes the ResizeObserver **and** the map. Callers
 * must call it from their effect cleanup; it is safe to call twice.
 */
export async function createBaseMap({
  container,
  center,
  zoom,
  onFatalError,
  cancelled = () => false,
}: {
  container: HTMLElement;
  center: [number, number];
  zoom: number;
  onFatalError: () => void;
  cancelled?: () => boolean;
}): Promise<(BaseMap & { dispose: () => void }) | null> {
  const { Map, Marker, LngLatBounds, setWorkerUrl } = await import("maplibre-gl");
  if (cancelled()) return null;

  // Note 1 — before the first construction, which spawns the worker pool.
  setWorkerUrl(MAPLIBRE_WORKER_URL);

  const map = new Map({ container, style: STYLE_URL, center, zoom });

  // Note 2 — for the container's whole lifetime, not just the first paint:
  // a rail toggling or a real window resize changes this element later too.
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(container);

  // Note 3.
  map.on("error", (event) => {
    if (isFatalMapError(event)) onFatalError();
  });

  // Note 4.
  map.on("styleimagemissing", (e: { id: string }) => {
    if (map.hasImage(e.id)) return;
    map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resizeObserver.disconnect();
    map.remove();
  };

  return { map, Marker, LngLatBounds, dispose };
}
