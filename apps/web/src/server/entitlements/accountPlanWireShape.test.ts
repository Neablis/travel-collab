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

// **The no-price rule was here, and M21 link 2 is where it goes.**
//
// It was a compile-time constraint — `MoneyKeys<T>` over `keyof`, so a field
// named for money could not be ADDED without breaking the build — and M21's own
// file names deleting it as part of this link's definition of done: *"that
// second test is the one to delete in this milestone, and deleting it
// deliberately is the point — it exists so the price arrives on purpose rather
// than by drift."*
//
// It worked. The price is on this wire because a milestone decided it, in a
// diff that had to remove this guard to land, and the guard's own mechanism is
// what made that unavoidable rather than optional. Nothing replaces it here:
// the identity check below now covers the price fields like every other field,
// which is the ordinary protection, and what the price may be is pinned in
// `planVersions.noExtension.test.ts`.

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
});
