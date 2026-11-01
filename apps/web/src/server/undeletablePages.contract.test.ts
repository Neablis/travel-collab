import { describe, expect, it } from "vitest";
import { pageKindOf } from "@tc/contracts";
import { OVERVIEW_UNDELETABLE, TODAY_UNDELETABLE, undeletableReason } from "@tc/domain";
import { TEMPLATE_LIBRARY, instantiateDefaults, isUndeletablePage } from "@tc/pages";

// One rule, two copies (PR 540 review, finding 5). The server refuses a delete
// on `undeletableReason` (`@tc/domain`); the index hides Delete and MSW answers
// 409 on `isUndeletablePage` (`@tc/pages`). Neither package may import the
// other, so each spells Today's seed key itself, and only this app sees both.
// If they drift, the index offers a Delete that always gets a 409, or hides one
// that works.
describe("which notebooks cannot be deleted", () => {
  // Each with the kind its row is written with (`pageKindOf`, M43).
  const asRow = (seedKey: string | null) => ({ seedKey, kind: pageKindOf(seedKey) });
  const seeded = instantiateDefaults("t", () => "id").map((seed) => asRow(seed.seedKey));

  it("is the same answer from the domain and from @tc/pages, for every seed and a notebook of your own", () => {
    const library = TEMPLATE_LIBRARY.map((t) => asRow(t.key));
    for (const page of [...seeded, ...library, asRow(null)]) {
      expect({ seedKey: page.seedKey, domain: undeletableReason(page) !== null }).toEqual({
        seedKey: page.seedKey,
        domain: isUndeletablePage(page),
      });
    }
  });

  it("covers the Overview and Today, so the comparison above is not vacuous", () => {
    expect(seeded.map((page) => undeletableReason(page))).toEqual(
      expect.arrayContaining([OVERVIEW_UNDELETABLE, TODAY_UNDELETABLE]),
    );
  });
});
