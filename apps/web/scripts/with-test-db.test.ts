// The four decisions in with-test-db.mjs that are not a transcript of a
// Postgres call, and where being wrong is silent rather than loud:
//
//   - which hosts may be provisioned on (it issues DROP DATABASE),
//   - what URL the child actually gets (a wrong one still connects, to the
//     shared database, and the run looks isolated while it is not),
//   - which database names the sweep will consider (it drops them), and
//     which of those is a live build rather than a corpse,
//   - when the template must be rebuilt (a stale one runs the suite against
//     the wrong schema).
//
// The provisioning flow itself is not stubbed here: it is three Postgres
// statements whose behavior is Postgres's, and a stub asserting we call them
// would only restate the source. It is covered by running the lanes.
//
// Lives beside the script rather than under src/ for the same reason
// geocode-japan-seed.test.ts does; vitest.unit.config.ts's node project names
// it file by file.
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertLocalHost,
  buildingFingerprint,
  migrationsFingerprint,
  runDbAgeMs,
  runDbName,
  withDatabase,
} from "./with-test-db.mjs";

describe("assertLocalHost", () => {
  it("accepts every spelling of the local server", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(() => assertLocalHost(`postgres://postgres:postgres@${host}:5433/travel`)).not.toThrow();
    }
  });

  it("refuses a remote host, so it can never drop a Neon branch", () => {
    expect(() =>
      assertLocalHost("postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/travel"),
    ).toThrow(/refusing to provision/);
  });

  it("refuses a host that merely contains 'localhost'", () => {
    expect(() => assertLocalHost("postgres://u:p@localhost.evil.example/travel")).toThrow(
      /refusing to provision/,
    );
  });
});

describe("withDatabase", () => {
  it("swaps only the database, keeping credentials, port and options", () => {
    const swapped = withDatabase(
      "postgres://postgres:s%2Fcret@127.0.0.1:5433/travel?sslmode=disable",
      "tc_test_1_abcdef",
    );
    const parsed = new URL(swapped);
    expect(parsed.pathname).toBe("/tc_test_1_abcdef");
    expect(parsed.username).toBe("postgres");
    expect(parsed.password).toBe("s%2Fcret");
    expect(parsed.port).toBe("5433");
    expect(parsed.searchParams.get("sslmode")).toBe("disable");
  });
});

describe("runDbAgeMs", () => {
  it("reads the age back out of a name this script generated", () => {
    const now = 1_757_000_000_000;
    expect(runDbAgeMs(runDbName(now - 90_000), now)).toBe(90_000);
  });

  it("returns null for names it did not generate, so the sweep leaves them alone", () => {
    // `travel` is the developer's own database and `tc_tmpl_*` is a template
    // another worktree may be mid-clone from. Dropping either is the worst
    // thing this file could do.
    for (const name of ["travel", "postgres", "tc_tmpl_ab12cd34ef56", "tc_test_notatimestamp_x"]) {
      expect(runDbAgeMs(name, Date.now())).toBeNull();
    }
  });
});

describe("buildingFingerprint", () => {
  it("reads the fingerprint back out of a half-built template's name", () => {
    expect(buildingFingerprint("tc_tmpl_6268a8ba5eb1_building")).toBe("6268a8ba5eb1");
  });

  it("returns null for a finished template, which must never be swept", () => {
    // The sweep asks the fingerprint's advisory lock whether a build is live
    // before dropping anything. A finished template has no lock holder, so
    // mistaking one for a `_building` leftover would drop the template another
    // worktree is cloning from.
    for (const name of ["tc_tmpl_6268a8ba5eb1", "tc_test_1788507172055_2uvjde", "travel"]) {
      expect(buildingFingerprint(name)).toBeNull();
    }
  });
});

describe("migrationsFingerprint", () => {
  const migrationsDir = (files: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "tc-migrations-"));
    mkdirSync(path.join(dir, "meta"));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries: [] }));
    return dir;
  };

  it("is stable for the same migrations", () => {
    const files = { "0000_a.sql": "create table a ();", "0001_b.sql": "create table b ();" };
    expect(migrationsFingerprint(migrationsDir(files))).toBe(
      migrationsFingerprint(migrationsDir(files)),
    );
  });

  it("changes when a migration's contents change", () => {
    const before = migrationsFingerprint(migrationsDir({ "0000_a.sql": "create table a ();" }));
    const after = migrationsFingerprint(migrationsDir({ "0000_a.sql": "create table a (id int);" }));
    expect(after).not.toBe(before);
  });

  it("changes when a migration is added", () => {
    const before = migrationsFingerprint(migrationsDir({ "0000_a.sql": "create table a ();" }));
    const after = migrationsFingerprint(
      migrationsDir({ "0000_a.sql": "create table a ();", "0001_b.sql": "create table b ();" }),
    );
    expect(after).not.toBe(before);
  });
});
