// **Entitlements does not know what a trip is** (ADR-045 rule 5).
//
// It answers `can(account, "trip.collaborators")`. The *caller* — Access &
// Membership — knows that capability is about invites. The string is an opaque
// token here: this module owns the vocabulary, not the domain meaning behind
// any member of it.
//
// This is what keeps M20 link 6 from being a boundary violation, and Phase 4 is
// where the temptation lands: the collaboration gate needs a trip's owner and
// that owner's entitlements, and the cheap move is to put `tripId` in this
// module's signature. Identity has carried the same rule since the module map
// was written; this is the second module that will be tempted to break it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function moduleFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  walk(HERE);
  return out;
}

const source = (file: string) => readFileSync(file, "utf8");
const named = (file: string) => path.basename(file);

describe("the Entitlements module knows nothing about trips", () => {
  // Every import in the module, flattened. A trip type arriving as a `type`
  // import is the same violation as a value one — it puts the domain in the
  // signature either way.
  it("imports no trip type from anywhere", () => {
    const offenders: string[] = [];
    for (const file of moduleFiles()) {
      const imports = [...source(file).matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)];
      for (const match of imports) {
        const statement = match[0];
        const from = match[1]!;
        // The planning domain and the Access module, by path.
        if (/@tc\/domain|server\/access\/|server\/projections|server\/commands|server\/accessPolicy/.test(from)) {
          offenders.push(`${named(file)} → ${from}`);
          continue;
        }
        // Contracts is allowed — it is where `Entitlement` lives — but only for
        // the entitlement vocabulary. A `TripDetail` or a `TripRole` pulled out
        // of the same package is the violation wearing an allowed path.
        if (from === "@tc/contracts" && /\bTrip[A-Z]|\bDay\b|\bActivity\b|\bSavedDay\b|\bPage[A-Z]/.test(statement)) {
          offenders.push(`${named(file)} → ${statement.replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The other direction the boundary breaks: a function here taking a `tripId`.
  // The gate belongs to Access & Membership, which reads a boolean from this
  // module; nothing here may be *about* a trip.
  it("takes no tripId in any signature", () => {
    const offenders = moduleFiles()
      .filter((file) => {
        const code = source(file)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        return /\btripId\b|\bsavedDayId\b|\bdayId\b|\bactivityId\b/.test(code);
      })
      .map(named);
    expect(offenders).toEqual([]);
  });

  // `trip.collaborators` may appear as data — it is a member of the vocabulary
  // — but nothing here may branch on it, which is what "opaque token" means.
  it("branches on no particular capability", () => {
    const offenders = moduleFiles()
      .filter((file) => named(file) !== "planVersions.ts")
      .filter((file) => {
        const code = source(file)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        // A comparison against a specific capability string is a branch.
        return /===\s*"(ai\.ask|ai\.command|trip\.collaborators)"/.test(code);
      })
      .map(named);
    expect(offenders).toEqual([]);
  });
});
