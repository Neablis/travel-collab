import { describe, expect, it } from "vitest";
import { TODAY_UNDELETABLE, undeletableReason } from "@tc/domain";
import { TEMPLATE_LIBRARY, TODAY_SEED_KEY, instantiateDefaults, isUndeletablePage } from "@tc/pages";

// One rule, two copies (PR 540 review, finding 5). The server refuses a delete
// on `undeletableReason` (`@tc/domain`); the index hides Delete and MSW answers
// 409 on `isUndeletablePage` (`@tc/pages`). Neither package may import the
// other, so each spells Today's seed key itself, and only this app sees both.
// If they drift, the index offers a Delete that always gets a 409, or hides one
// that works.
describe("which notebooks cannot be deleted", () => {
  const seeded = instantiateDefaults("t", () => "id");

  it("is the same answer from the domain and from @tc/pages, for every seed and a notebook of your own", () => {
    const yours = { context: { tripId: "t" }, seedKey: null };
    const library = TEMPLATE_LIBRARY.map((t) => ({ context: t.buildContext("t"), seedKey: t.key }));
    for (const page of [...seeded, ...library, yours]) {
      expect({ seedKey: page.seedKey, domain: undeletableReason(page) !== null }).toEqual({
        seedKey: page.seedKey,
        domain: isUndeletablePage(page),
      });
    }
  });

  it("covers Today, so the comparison above is not vacuous", () => {
    const today = seeded.find((page) => page.seedKey === TODAY_SEED_KEY);
    expect(today).toBeDefined();
    expect(undeletableReason(today!)).toBe(TODAY_UNDELETABLE);
  });
});
