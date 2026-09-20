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

  // **A tile failure is survivable and a source failure is not**, and the
  // discriminator is whether MapLibre attached the tile it was fetching.
  //
  // This pair replaces a single test that pinned the opposite — it asserted
  // that ANY source-attributed error was fatal, which is what the code did and
  // what its own comment three lines above denied. The test agreed with the
  // code and both were wrong together (CodeRabbit, PR 196).
  it("survives one tile that 404'd — the rest of the map is still readable", () => {
    expect(
      isFatalMapError({ error: { message: "404" }, sourceId: "openmaptiles", tile: { x: 1, y: 2, z: 3 } }),
    ).toBe(false);
  });

  it("gives up when a SOURCE failed to initialise — it will never produce tiles", () => {
    expect(isFatalMapError({ error: { message: "Unable to load TileJSON" }, sourceId: "openmaptiles" })).toBe(
      true,
    );
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
