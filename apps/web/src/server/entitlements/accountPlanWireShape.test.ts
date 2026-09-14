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

/**
 * **The no-price rule, as a type rather than a list.**
 *
 * This was a loop over hand-written arrays of the CURRENT key names — so adding
 * `price` to either interface left the arrays unchanged, the loop checking the
 * old keys, and the test green. It listed what exists instead of constraining
 * what may exist, which is the same failure as a field-name wire check passing
 * while a type changed. CodeRabbit, PR #174.
 *
 * `keyof` is exhaustive by construction: a new key is in the union the moment
 * it is declared, so a field named for money cannot be added without breaking
 * the build. M20 never learns what a plan costs (link 7's split note), and M21
 * link 7 names deleting this as part of its own definition of done — which is
 * the point of making it a compile error rather than a runtime scan: the price
 * arrives on purpose.
 */
type PriceWord = "price" | "amount" | "cost" | "renew" | "subscription" | "invoice" | "currency";

/** The keys of `T` that read as money, as a union — `never` when there are none. */
type MoneyKeys<T> = Extract<
  {
    [K in Extract<keyof T, string>]: Lowercase<K> extends `${string}${PriceWord}${string}`
      ? K
      : never;
  }[Extract<keyof T, string>],
  string
>;

type NoMoneyKeys<T> = [MoneyKeys<T>] extends [never] ? true : { forbidden: MoneyKeys<T> };

const viewIsPriceFree: NoMoneyKeys<UiView> = true;
const choiceIsPriceFree: NoMoneyKeys<UiChoice> = true;

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
    // The assertions are the two constants below, checked by the compiler. This
    // body only keeps the file a test.
    expect([viewIsPriceFree, choiceIsPriceFree]).toEqual([true, true]);
  });
});
