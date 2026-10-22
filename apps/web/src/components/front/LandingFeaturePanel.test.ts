import { describe, expect, it } from "vitest";
import { loadFeaturePanels } from "./LandingFeaturePanel";

// Every panel's lazy shares one import: two concurrent imports of a mocked
// module can resolve to the real one under vitest, which made
// the feature blocks' failed-load test (retired with the blocks in M51) fail
// only sometimes.
describe("loadFeaturePanels", () => {
  // The await is a cold transform of the panels' whole module tree, about 3s
  // alone and more beside other files, which is not what this test measures.
  it("hands every caller the same import", { timeout: 15_000 }, async () => {
    const first = loadFeaturePanels();
    expect(loadFeaturePanels()).toBe(first);
    await first;
  });
});
