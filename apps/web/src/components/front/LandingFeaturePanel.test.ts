import { describe, expect, it } from "vitest";
import { loadFeaturePanels } from "./LandingFeaturePanel";

// Every panel's lazy shares one import: two concurrent imports of a mocked
// module can resolve to the real one under vitest, which made
// `LandingFeatureBlocks.failed.test.tsx` fail only sometimes.
describe("loadFeaturePanels", () => {
  it("hands every caller the same import", () => {
    expect(loadFeaturePanels()).toBe(loadFeaturePanels());
  });
});
