import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { appliedKeys, recordReceipts } from "./commandReceipts";

class Rollback extends Error {}

// ADR-066 and PR #345's review: merging deploys the code before
// `migrate-production` creates the table, and every board edit carries a key.
// Until the table exists, a key must do nothing rather than fail the edit.
//
// Order matters, and is safe because Vitest gives each test file its own module
// instance: the first case runs before this module has ever seen the table.
describe("command receipts before and after migration 0041", () => {
  it("ignores keys, and fails nothing, while the table does not exist", async () => {
    const tripId = randomUUID();
    let seen: { applied: Set<string>; recorded: boolean } | null = null;
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`drop table command_receipts`);
        seen = { applied: await appliedKeys(tx, tripId, ["k"]), recorded: await recordReceipts(tx, tripId, ["k"]) };
        throw new Rollback(); // put the table back
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(seen).toEqual({ applied: new Set(), recorded: true });
  });

  it("uses the table as soon as it exists", async () => {
    const tripId = randomUUID();
    expect(await recordReceipts(db, tripId, ["k"])).toBe(true);
    expect(await appliedKeys(db, tripId, ["k", "other"])).toEqual(new Set(["k"]));
    expect(await recordReceipts(db, tripId, ["k"])).toBe(false);
  });
});
