// **Nothing may delete or sweep `api_tokens`.**
//
// The same rule as `entitlement_grants`, and here it carries a second reason of
// its own. Expiry and revocation are resolved on read, so a cleanup job would
// change no authorisation outcome at all — every token it deleted was already
// being refused. What it would destroy is the *explanation*: an expired token is
// refused rather than removed precisely so its owner can open the list, see what
// lapsed and when, and understand why an integration stopped. Delete the row and
// the answer becomes "your token vanished", which is the one response that sends
// someone to support.
//
// The temptation arrives later, when the table has grown and someone is tidying
// — so this is written now, while the table is new. It is a source sweep because
// the defect is a *deletion that exists*, and no behavioural test can assert the
// absence of a job nobody has written yet.
//
// **Revoking is not deleting.** `revokeToken` stamps `revoked_at` and leaves the
// row, which is what lets the list distinguish "you cut this off" from "this ran
// out" months afterwards.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

function filesUnder(dir: string, extensions: RegExp): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const name = entry.name;
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const full = path.join(current, name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * A cheap raw-text gate in front of the expensive comment strip — the lesson
 * `grants.retention.test.ts` learned by timing out on a cold CI filesystem.
 * Stripping comments only matters for a file that names the table at all.
 */
function mightMentionTokens(raw: string): boolean {
  return raw.includes("apiTokens") || raw.includes("api_tokens");
}

const RELATIVE = (full: string) => path.relative(WEB, full).split(path.sep).join("/");

describe("api_tokens is retained, never swept", () => {
  it("has no delete against it anywhere in the app", () => {
    const offenders = filesUnder(path.join(WEB, "src"), /\.(ts|tsx)$/)
      .filter((file) => RELATIVE(file) !== "src/server/api-tokens/apiTokens.retention.test.ts")
      .filter((file) => {
        const raw = readFileSync(file, "utf8");
        if (!mightMentionTokens(raw)) return false;
        const code = stripComments(raw);
        return (
          /\.delete\s*\(\s*apiTokens\s*\)/.test(code) ||
          /delete\s+from\s+"?api_tokens"?/i.test(code)
        );
      })
      .map(RELATIVE);
    expect(offenders).toEqual([]);
  });

  // A migration is the other place a sweep arrives, and a `DELETE` there is
  // permanent in a way an application bug is not.
  it("has no delete against it in any migration", () => {
    const offenders = filesUnder(path.join(WEB, "drizzle"), /\.sql$/)
      .filter((file) => {
        const sql = stripComments(readFileSync(file, "utf8")).replace(/^--.*$/gm, "");
        return (
          /delete\s+from\s+"?api_tokens"?/i.test(sql) ||
          /truncate\s+"?api_tokens"?/i.test(sql) ||
          /drop\s+table[\s\S]{0,40}"?api_tokens"?/i.test(sql)
        );
      })
      .map(RELATIVE);
    expect(offenders).toEqual([]);
  });

  // The scripts directory is where a "expire old tokens" job would actually be
  // written. `db-reset.mjs` drops the whole schema for local development, which
  // is a rebuild rather than a sweep of this table, and it names no table.
  it("has no sweep job in scripts", () => {
    const offenders = filesUnder(path.join(WEB, "scripts"), /\.(mjs|ts|mts|js)$/)
      .filter((file) => /api_tokens/i.test(readFileSync(file, "utf8")))
      .map(RELATIVE);
    expect(offenders).toEqual([]);
  });

  // The positive half: the write surface offers a revoke and no remove. A
  // `deleteToken` export is the shape the sweep would be built from, and it
  // would pass every sweep above until something called it.
  it("offers revoking and nothing that removes a row", () => {
    const code = stripComments(readFileSync(path.join(HERE, "index.ts"), "utf8"));
    expect(code).toMatch(/export async function revokeToken/);
    expect(code).not.toMatch(/deleteToken|purgeTokens|sweepTokens|expireTokens|cleanupTokens/i);
    expect(code).not.toMatch(/\bdb\s*\.\s*delete\b/);
  });

  // **No entitlement may be cached on the row**, which is a different rule with
  // the same enforcement shape: a column that does not exist cannot go stale.
  // M20's third rule — a downgrade must bite before a token refreshes, and a
  // token lives for months.
  it("keeps no plan or entitlement column on the table", () => {
    const schema = stripComments(readFileSync(path.join(WEB, "src/server/db/schema.ts"), "utf8"));
    // **Both boundaries are asserted before anything is sliced**, because a
    // sweep that cannot find what it is sweeping passes vacuously — every
    // `not.toContain` below holds trivially against an empty string, and the
    // test would go on reporting success while checking nothing. (The ternary
    // this replaces had the same expression in both branches, which is how the
    // hazard got in.) CodeRabbit on pull request 185.
    const start = schema.indexOf('"api_tokens"');
    expect(start, "api_tokens is not in schema.ts — this sweep is checking nothing").toBeGreaterThan(-1);
    const table = schema.slice(start);
    const end = table.indexOf(");");
    expect(end, "the api_tokens table body has no terminator").toBeGreaterThan(-1);
    const body = table.slice(0, end);
    expect(body.length).toBeGreaterThan(0);
    for (const forbidden of ["plan_id", "plan_version", "entitlement", "planId", "planVersion"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});
