// **"The webhook is the only thing in the product that writes `subscriptions`
// or `users.plan`"** (M21 link 4), as a sweep rather than as a sentence.
//
// The rule is a correctness claim, not a tidiness one: a checkout redirect is a
// hint, never a grant, and the classic way a paywall becomes free is a success
// URL that writes. The second writer that would do it is not malicious and is
// never called "grant the plan from the redirect" — it is a helpful
// `/api/billing/success` route that updates the row so the page has something
// to show. This test is what makes that arrive as a red build.
//
// **Why a source sweep and not a runtime assertion.** The property is "nothing
// anywhere does this", and no runtime test can observe code that has not been
// called. The same reasoning `grants.retention.test.ts` and
// `moduleBoundary.test.ts` already use one directory over.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceFilesUnder, strippedIfMentions, strippedSource } from "@/test-support/sourceSweep";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

const relative = (file: string) => path.relative(SRC, file);
const code = strippedSource;

// One walk, and each file parsed at most once across every sweep below: the
// comment-strip is a full TypeScript parse, and doing it for all ~400 files per
// sweep is what timed out under load (KI-20260924-f). A sweep that needs a
// literal token asks `strippedIfMentions`, which skips the parse for a file
// whose raw text lacks it — sound, because stripping never adds a character.
const ALL = sourceFilesUnder(SRC).filter((file) => !/\.test\.tsx?$/.test(file));

/**
 * The payloads of every write to one table in a file.
 *
 * **The naive version — "does this file write `users` AND mention `planId`
 * anywhere" — was wrong on its first run**, and wrong in the direction that
 * matters: it reported `checkout.ts`, which writes only `stripe_customer_id`
 * and mentions `planId` because `startCheckout` takes one as an argument. A
 * sweep that cries wolf on the legitimate file is a sweep somebody widens an
 * allowlist to silence, and the allowlist is the thing being protected.
 *
 * So the payload is what is read: everything between `.update(table)` or
 * `.insert(table)` and the end of that statement's `.set({...})` /
 * `.values({...})` call, which is the only place a column can actually be
 * assigned.
 */
function writePayloads(source: string, table: string): string[] {
  const out: string[] = [];
  const starts = [...source.matchAll(new RegExp(String.raw`\.(update|insert)\(\s*${table}\s*\)`, "g"))];
  for (const start of starts) {
    const from = start.index! + start[0].length;
    // To the end of the chained statement: a `.where(`, a `.returning(`, a
    // `.onConflict…(`, or the semicolon that ends it — whichever comes first.
    const rest = source.slice(from, from + 2000);
    const end = rest.search(/\.where\(|\.returning\(|\.onConflict|;/);
    out.push(end === -1 ? rest : rest.slice(0, end));
  }
  return out;
}

describe("only the webhook writes what an account pays for", () => {
  // **The store, and the one module allowed to drive it.** `subscriptions.ts`
  // holds the insert and the update; `webhook.ts` holds the one call to each
  // plus the decline anchor. Nothing else may name the table in a write
  // position — and the list is two entries because a third would mean the
  // single writer has become a convention.
  const MAY_WRITE_SUBSCRIPTIONS = new Set(["server/billing/subscriptions.ts", "server/billing/webhook.ts"]);

  it("writes the subscriptions table from two files and no others", () => {
    expect(ALL.length).toBeGreaterThan(100);
    const offenders = ALL.filter((file) => {
      if (MAY_WRITE_SUBSCRIPTIONS.has(relative(file))) return false;
      const source = strippedIfMentions(file, /subscriptions/);
      if (source === null) return false;
      return (
        /\.insert\(\s*subscriptions\s*\)/.test(source) ||
        /\.update\(\s*subscriptions\s*\)/.test(source) ||
        /\.delete\(\s*subscriptions\s*\)/.test(source)
      );
    }).map(relative);
    expect(offenders).toEqual([]);
  });

  // **`users.plan_id` is what M20's resolver reads**, so a purchase has to land
  // there — and so does anything that wanted to fake one. Two writers are
  // legitimate and they do different jobs: account creation gives a new row the
  // live `free` version, and the webhook moves it when a subscription starts or
  // definitively ends.
  const MAY_WRITE_HELD_PLAN = new Set([
    "server/billing/webhook.ts",
    // `upsertUser` — insert-only for these columns, which is itself asserted by
    // `resolver.int.test.ts`'s "keeps its plan when it signs in again".
    "server/users.ts",
    // The operator console GRANTS, which is a different table entirely; this
    // entry is here so that the day it starts writing a held plan, the change
    // is deliberate.
    "server/entitlements/grants.ts",
    // **A test fixture, and listed rather than excluded by a path rule.** It
    // puts integration suites' trip owners on `premium` so that suites about
    // invites and members are not silently about entitlements (M20 link 6). It
    // is imported by five `.int.test.ts` files and by nothing that ships.
    //
    // A blanket "skip anything under test-support" would have been shorter and
    // would have covered a file that one day gets imported by product code.
    // One entry is the smaller hole.
    "server/test-support/entitledAccount.ts",
  ]);

  it("moves an account's held plan from the webhook, account creation and nowhere else", () => {
    const offenders = ALL.filter((file) => {
      if (MAY_WRITE_HELD_PLAN.has(relative(file))) return false;
      // Every payload pattern below needs `planId` or `planVersion` literally.
      const source = strippedIfMentions(file, /planId|planVersion/);
      if (source === null) return false;
      return writePayloads(source, "users").some((payload) =>
        /\bplanId\s*:|\bplanVersion\s*:/.test(payload),
      );
    }).map(relative);
    expect(offenders).toEqual([]);
  });

  // **The route a paywall dies on.** Anything under `app/api/billing/**` exists
  // to hand a browser a Stripe URL; the moment one of them writes a plan, the
  // redirect has become the grant.
  it("writes nothing about a plan from the checkout or portal routes", () => {
    const routes = ALL.filter((file) => relative(file).startsWith("app/api/billing/"));
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const file of routes) {
      const source = code(file);
      expect(source, relative(file)).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
    }
  });

  // `stripe_customer_id` is the ONE column outside that rule, and it is not an
  // exception to it: a customer id is who you are at Stripe, not what you are
  // entitled to, and it must exist before a Checkout Session can name it. It is
  // listed here so the exception is a decision somebody wrote down.
  it("lets checkout write the Stripe customer id, which grants nothing", () => {
    const checkout = code(path.join(SRC, "server/billing/checkout.ts"));
    const payloads = writePayloads(checkout, "users");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatch(/stripeCustomerId/);
    expect(payloads[0]).not.toMatch(/planId|planVersion/);
  });
});
