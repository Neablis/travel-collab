// **Nothing may delete or sweep `entitlement_grants`.**
//
// M20's rule, and the milestone says in as many words how it dies: *"a cleanup
// job that removes expired rows silently restores the trial to everyone who
// ever had one, and it would look like generosity rather than a bug."*
//
// The temptation arrives later, when the table has grown and someone is tidying
// — so this is written now, while the table is new, which is what the plan asks
// for. It is a source sweep because the defect is a *deletion that exists*, and
// no behavioural test can assert the absence of a job nobody has written yet.
//
// **Revoking is not deleting.** `revokeGrant` stamps `revoked_at` and leaves
// the row, which is why the resolver and the eligibility check can disagree
// about the same row on purpose.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

function filesUnder(dir: string, extensions: RegExp): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const RELATIVE = (full: string) => path.relative(WEB, full).split(path.sep).join("/");

describe("entitlement_grants is retained, never swept", () => {
  // Drizzle's delete builder, targeted at this table. The two spellings are
  // `db.delete(entitlementGrants)` and a raw `DELETE FROM "entitlement_grants"`.
  it("has no delete against it anywhere in the app", () => {
    const offenders = filesUnder(path.join(WEB, "src"), /\.(ts|tsx)$/)
      .filter((file) => RELATIVE(file) !== "src/server/entitlements/grants.retention.test.ts")
      .filter((file) => {
        const code = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        return (
          /\.delete\s*\(\s*entitlementGrants\s*\)/.test(code) ||
          /delete\s+from\s+"?entitlement_grants"?/i.test(code)
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
        const sql = readFileSync(file, "utf8").replace(/^--.*$/gm, "");
        return (
          /delete\s+from\s+"?entitlement_grants"?/i.test(sql) ||
          /truncate\s+"?entitlement_grants"?/i.test(sql) ||
          /drop\s+table[\s\S]{0,40}"?entitlement_grants"?/i.test(sql)
        );
      })
      .map(RELATIVE);
    expect(offenders).toEqual([]);
  });

  // The scripts directory is where a "tidy the database" job would actually be
  // written, and `db-reset.mjs` is the one file allowed to drop everything —
  // it drops the whole schema for local development, which is not a sweep of
  // this table but a rebuild of the database.
  it("has no sweep job in scripts, beyond the whole-database reset", () => {
    const offenders = filesUnder(path.join(WEB, "scripts"), /\.(mjs|ts|mts|js)$/)
      .filter((file) => /entitlement_grants/i.test(readFileSync(file, "utf8")))
      .map(RELATIVE);
    expect(offenders).toEqual([]);
  });

  // The positive half: the write surface offers a revoke and no remove. A
  // `deleteGrant` export is the shape the sweep would be built from, and it
  // would pass every sweep above until something called it.
  it("offers revoking and nothing that removes a row", () => {
    const code = readFileSync(path.join(HERE, "grants.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/export async function revokeGrant/);
    expect(code).not.toMatch(/deleteGrant|purgeGrants|sweepGrants|expireGrants|cleanupGrants/i);
    expect(code).not.toMatch(/\bdb\s*\.\s*delete\b/);
  });
});
