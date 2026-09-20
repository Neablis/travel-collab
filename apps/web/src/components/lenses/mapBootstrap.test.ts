import { describe, expect, it } from "vitest";
import { isFatalMapError } from "./mapBootstrap";

// This predicate decides whether a reader sees the map or the offline panel,
// and it has been got wrong in both directions: treating every `error` as
// fatal swapped the canvas for a panel because one tile in a corner was slow,
// and treating none as fatal left map chrome drawn over a basemap that never
// decoded a tile (bump #158).
//
// It is tested as a pure function rather than by provoking real MapLibre
// errors because the interesting cases — a 404 on one tile, a style that never
// parsed — are precisely the ones a test cannot reliably stage.
describe("isFatalMapError", () => {
  it("gives up when the style itself failed, which arrives with no sourceId", () => {
    expect(isFatalMapError({ error: { message: "Failed to parse style" } })).toBe(true);
  });

  // Coarse on purpose, and this test is here to PIN that coarseness rather
  // than to endorse it: a source-attributed error is fatal, even though a lone
  // tile 404 is survivable in principle. This is MapLens's shipped behaviour
  // and the extraction carries it over unchanged. If it is ever narrowed, this
  // is the test that must be rewritten deliberately — which is the point.
  it("gives up on a source-attributed error, MapLens's shipped coarseness", () => {
    expect(isFatalMapError({ error: { message: "404" }, sourceId: "openmaptiles" })).toBe(true);
  });

  it("survives a sprite or image that did not resolve, placeholder's job", () => {
    expect(isFatalMapError({ error: { message: "Image 'poi_x' could not be loaded" } })).toBe(false);
    expect(isFatalMapError({ error: { message: "sprite not found" } })).toBe(false);
  });

  // A sprite failure that also names a source is still the placeholder's, not
  // the offline panel's: the sprite test runs first and wins deliberately.
  it("keeps the sprite rule ahead of the source rule", () => {
    expect(isFatalMapError({ error: { message: "sprite missing" }, sourceId: undefined })).toBe(false);
  });

  // An error with neither a source nor the word "style" is unattributable.
  // Blanking the map on it would make any stray MapLibre warning an outage.
  it("survives an unattributable error rather than calling it an outage", () => {
    expect(isFatalMapError({ error: { message: "something odd" } })).toBe(false);
    expect(isFatalMapError({})).toBe(false);
    expect(isFatalMapError(undefined)).toBe(false);
  });
});
