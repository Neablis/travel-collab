// **"The template row is CRUD, not an event stream"** (M14 gate, link 10), as a
// sweep rather than as a sentence — `billing/soleWriter.test.ts`'s method.
//
// Two claims, and both are about code that has not been called, which is why
// they are a source sweep and not a runtime assertion:
//
// 1. `server/savedNotebooks.ts` is the ONLY file that inserts, updates or
//    deletes `saved_notebooks`. A second writer is how a personal library grows
//    a back door — a route that "just fixes the title" without the owner scope.
// 2. No saved notebook reaches the event log. ADR-029: a personal library is
//    not planning state, and the page an instantiate creates goes through
//    `executePageCommand` into the TARGET trip's stream — the template itself
//    is never appended anywhere.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceFilesUnder, strippedIfMentions, strippedSource } from "@/test-support/sourceSweep";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const relative = (file: string) => path.relative(SRC, file);

const ALL = sourceFilesUnder(SRC).filter((file) => !/\.test\.tsx?$/.test(file));

describe("saved notebooks are CRUD with one writer", () => {
  const SOLE_WRITER = "server/savedNotebooks.ts";

  it("writes the saved_notebooks table from one file and no other", () => {
    expect(ALL.length).toBeGreaterThan(100);
    const writers = ALL.filter((file) => {
      const source = strippedIfMentions(file, /savedNotebooks/);
      if (source === null) return false;
      return /\.(insert|update|delete)\(\s*savedNotebooks\s*\)/.test(source);
    }).map(relative);
    // Equality, not "offenders is empty": if the one writer stopped matching —
    // renamed, or its table import aliased — an empty offender list would stay
    // green while sweeping for nothing.
    expect(writers).toEqual([SOLE_WRITER]);
  });

  // Raw SQL is the way round a pattern over Drizzle calls, and the migrations
  // are the only place that may name the table in SQL.
  it("names the table in SQL nowhere outside the migrations", () => {
    const offenders = ALL.filter((file) => /saved_notebooks/.test(strippedIfMentions(file, /saved_notebooks/) ?? ""))
      .filter((file) => relative(file) !== "server/db/schema.ts")
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("appends nothing to the event log", () => {
    const source = strippedSource(path.join(SRC, SOLE_WRITER));
    expect(source).not.toMatch(/appendToStream|executeTripCommand|eventStore/);
    // The one command it runs creates a PAGE in the target trip — and it is
    // there, so the line above is a claim about a module that does write
    // somewhere, not about an empty file.
    expect(source).toMatch(/executePageCommand\(/);
    expect(fs.existsSync(path.join(SRC, SOLE_WRITER))).toBe(true);
  });
});
