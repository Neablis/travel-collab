// **`Money` must not appear anywhere on the cost ledger's path** (M20 link 9).
//
// The reason is arithmetic, not taste. ADR-008 defines
// `Money = { amountMinor, currency }` in **integer minor units** — whole cents
// for USD — and a live request costs **$0.0006**, six hundredths of a cent,
// which rounds to **zero**. Every request would record as free.
//
// That is the KI-1 / KI-14 / `budgetPerPerson` defect class — a field asserting
// a semantic its arithmetic does not have — on its **third recorded
// recurrence** in this repo. The first two were found by a person noticing;
// this is the version that fails a test.
//
// A source sweep, because what is being asserted is an ABSENCE. There is no
// behaviour to drive: the defect is a type arriving, and by the time it has
// arrived every number it touches is already wrong in a way that looks right.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";
import { MODEL_RATES, microUsdFor } from "./modelRates";
import { aiUsage } from "@/server/db/schema";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

/** A file with its prose removed — a comment explaining the rule is not the rule broken. */
function codeOf(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

// The whole path a token count travels: the kernel's ledger type, the writer,
// the rate record, and the migration that shapes the row.
const LEDGER_PATH = [
  path.join(WEB, "src/server/assistant/ledger.ts"),
  path.join(HERE, "usage.ts"),
  path.join(HERE, "modelRates.ts"),
];

describe("no currency type reaches the cost ledger", () => {
  it("imports no Money and names no currency", () => {
    for (const file of LEDGER_PATH) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\bMoney\b/);
      expect(code, file).not.toMatch(/\bamountMinor\b/);
      expect(code, file).not.toMatch(/\bcurrency\b/i);
      // The import is the door it would come through.
      expect(code, file).not.toMatch(/from\s+"@tc\/contracts"[\s\S]{0,2}$/m);
    }
  });

  // The stored row is the thing that would be permanently wrong, so it is
  // asserted against the TABLE rather than against a file.
  it("has no dollar column on the row", () => {
    for (const column of Object.keys(aiUsage)) {
      expect(column).not.toMatch(/money|amount|minor|usd|dollar|cost|price|currency/i);
    }
  });

  it("has no dollar column in the migration that created it", () => {
    const sql = readFileSync(path.join(WEB, "drizzle/0020_ai_usage_ledger.sql"), "utf8").replace(
      /^--.*$/gm,
      "",
    );
    expect(sql).not.toMatch(/money|numeric|decimal|amount_minor|usd|price|cost/i);
  });
});

describe("the rate record is integer micro-dollars", () => {
  // Not floats. A rate read as `0.13` and multiplied across a month of rows
  // accumulates error, and the whole point of re-deriving is that two
  // derivations of the same month agree.
  it("stores every rate as a safe integer", () => {
    for (const rate of MODEL_RATES) {
      expect(Number.isSafeInteger(rate.inputMicroUsdPerMTok)).toBe(true);
      expect(Number.isSafeInteger(rate.outputMicroUsdPerMTok)).toBe(true);
    }
  });

  // And the join returns one too — a fractional micro-dollar is the same defect
  // one decimal place further down.
  it("returns a safe integer from the join", () => {
    const at = new Date("2026-09-13T00:00:00Z");
    const priced = microUsdFor("deepseek/deepseek-v4-flash-0731", 3363, 512, at);
    expect(Number.isSafeInteger(priced)).toBe(true);
  });

  // **The measurement this whole rule exists for.** The one live `ai.ask`
  // record cost about $0.0006. In `Money`'s integer minor units that is 0.06
  // cents, which rounds to zero — so this asserts both halves at once: the
  // real cost is non-zero in micro-dollars, and it would have been zero in
  // cents.
  it("prices the one live record above zero, where Money would have said free", () => {
    const at = new Date("2026-09-13T00:00:00Z");
    const turn = microUsdFor("deepseek/deepseek-v4-flash-0731", 3363, 512, at)!;
    const classifier = microUsdFor("zai/glm-4.7-flash", 198, 49, at)!;
    const microUsd = turn + classifier;
    expect(microUsd).toBeGreaterThan(0);
    // Six ten-thousandths of a dollar, give or take.
    expect(microUsd).toBeLessThan(1_000);
    // What `Money` would have stored: whole cents.
    expect(Math.round(microUsd / 10_000)).toBe(0);
  });
});
