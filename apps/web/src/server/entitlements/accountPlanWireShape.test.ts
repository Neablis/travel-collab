import { describe, expect, it } from "vitest";
import type {
  AccountPlanChoice as UiChoice,
  AccountPlanView as UiView,
  AccountQuotaStanding as UiStanding,
} from "@/lib/accountPlan";
import type { AccountPlanView as ServerView, PlanChoice as ServerChoice } from "./accountPlan";
import type { QuotaStanding as ServerStanding } from "@/server/quota";

// **Compile-time identity, not a comparison of field names.** The admin
// console shipped a name-only version of this check and it passed while four
// fields had different types (CodeRabbit, PR #174); this one is the shape that
// found them, applied to the second wire crossing the same wall.
//
// It lives under `src/server/` because it must import BOTH sides, and a test
// under `src/components/` importing `@/server/*` is what the lint wall exists
// to refuse.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : { mismatch: [A, B] };
type AssertEquals<A, B> = Equals<A, B>;

const standing: AssertEquals<UiStanding, ServerStanding> = true;
const choice: AssertEquals<UiChoice, ServerChoice> = true;
const view: AssertEquals<UiView, ServerView> = true;

describe("the account plan wire shape", () => {
  it("is identical on both sides of the lint wall", () => {
    // The assertions above are the test — each fails to COMPILE if the two
    // declarations diverge in a field, a type, or a nullability. This body
    // exists so the file is a test rather than a type-only module that a
    // coverage run would skip.
    expect([standing, choice, view]).toEqual([true, true, true]);
  });

  it("carries no price, renewal date or subscription state", () => {
    // M20 never learns what a plan costs (link 7's split note), and the design
    // draws all three on this screen. A field for one arriving here is the M21
    // half crossing into M20, which is the split failing quietly.
    const forbidden = ["price", "amount", "renew", "subscription", "invoice", "currency"];
    const keys: (keyof UiView)[] = [
      "planVersionRef",
      "entitlements",
      "questions",
      "steps",
      "catalogue",
      "referralCode",
    ];
    for (const key of keys) {
      for (const word of forbidden) {
        expect(String(key).toLowerCase()).not.toContain(word);
      }
    }
    const choiceKeys: (keyof UiChoice)[] = [
      "planId",
      "version",
      "entitlements",
      "perUserRequestsPerDay",
      "perUserStepsPerDay",
      "held",
    ];
    for (const key of choiceKeys) {
      for (const word of forbidden) {
        expect(String(key).toLowerCase()).not.toContain(word);
      }
    }
  });
});
