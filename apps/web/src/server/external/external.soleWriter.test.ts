// **`external_data_cache` has one writer** (ADR-052 decision 2), as a sweep —
// `savedNotebooks.soleWriter.test.ts`' method, for the same reason: both
// claims are about code that has not been called.
//
// 1. `server/external/cache.ts` is the ONLY file that inserts, updates or
//    deletes the table. A second writer is how a route "just warms the cache"
//    with a vendor payload rather than a normalized one, or with a key finer
//    than the rounded point.
// 2. Nothing from outside reaches the event log. Invariant 1 scopes the log to
//    planning, and a forecast replayed from it would be stale weather wearing
//    the costume of a decision.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceFilesUnder, strippedIfMentions, strippedSource } from "@/test-support/sourceSweep";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const relative = (file: string) => path.relative(SRC, file);

const ALL = sourceFilesUnder(SRC).filter((file) => !/\.test\.tsx?$/.test(file));

describe("external_data_cache has one writer", () => {
  const SOLE_WRITER = "server/external/cache.ts";

  it("writes the table from one file and no other", () => {
    expect(ALL.length).toBeGreaterThan(100);
    const writers = ALL.filter((file) => {
      const source = strippedIfMentions(file, /externalDataCache/);
      if (source === null) return false;
      return /\.(insert|update|delete)\(\s*externalDataCache\s*\)/.test(source);
    }).map(relative);
    // Equality, not "no offenders": an empty list would stay green if the one
    // writer stopped matching, sweeping for nothing.
    expect(writers).toEqual([SOLE_WRITER]);
  });

  it("names the table in SQL nowhere outside the schema and the migrations", () => {
    const offenders = ALL.filter((file) => /external_data_cache/.test(strippedIfMentions(file, /external_data_cache/) ?? ""))
      .filter((file) => relative(file) !== "server/db/schema.ts")
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("appends nothing to the event log, from the cache or the weather service", () => {
    for (const file of [SOLE_WRITER, "server/external/weather/tripWeather.ts"]) {
      const source = strippedSource(path.join(SRC, file));
      expect(source, file).not.toMatch(/appendToStream|executeTripCommand|executePageCommand|eventStore/);
    }
    // And the writer does write, so the line above is about a module that
    // touches the database rather than an empty file.
    expect(strippedSource(path.join(SRC, SOLE_WRITER))).toMatch(/\.insert\(externalDataCache\)/);
  });
});
