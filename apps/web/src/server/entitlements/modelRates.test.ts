import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rateAt } from "./modelRates";

// Every model production runs has a price (found by M33, 2026-10-05: the cheap
// tier's `zai/glm-4.7-flashx` and the strong tier's `zai/glm-5.3` had none, so
// every turn on either was counted as unpriced). `models.json` is the record of
// what production runs, per tier, read from the ledger; this holds the two
// files together, so a tier moved to a new model without a rate fails here.
const production = JSON.parse(
  readFileSync(join(import.meta.dirname, "../ai/eval/models.json"), "utf8"),
) as { tiers: Record<string, { model: string | null }> };

describe("the rate record", () => {
  it("prices every model production runs, as of today", () => {
    const today = new Date();
    for (const [tier, { model }] of Object.entries(production.tiers)) {
      expect(model, `${tier} has no model in models.json`).not.toBeNull();
      expect(rateAt(model!, today), `${tier}: ${model} has no rate in modelRates.ts`).not.toBeNull();
    }
  });
});
