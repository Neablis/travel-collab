// **Export is free, and this is what keeps it free** (M25 decision 3).
//
// Mitchell, 2026-09-18, on two grounds: *"free keeps trip planning entire"* is
// M20's line, and a trip you cannot take out is not an entire one; and data
// portability is a **trust** property rather than a paid feature — charging for
// the exit is the one paywall that makes the rest of the product harder to
// believe.
//
// **The consequence is an ABSENCE, which is the hardest kind of property to
// keep.** Nothing on the export or import path checks an entitlement, so
// nothing on those paths will go red when somebody adds one: a diff that gates
// export behind `premium` would pass every other test in this repo. This file
// is the thing that fails instead.
//
// **And an entitlement is not the only way to break it.** Adding one to
// `Entitlement` would publish a new plan version under ADR-045 rule 1 — a
// `premium@v3`, a second cohort of subscribers pinned to a version that
// predates the feature, and the whole pinning problem M22 raised, walked into
// for a feature that was decided to be free. So the vocabulary sweep below is
// paired with a check that the entitlement list itself has not moved.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENTITLEMENTS } from "@tc/contracts";
import { stripComments } from "@/test-support/stripComments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");
const REPO = path.resolve(WEB, "../..");

/**
 * Every file a trip travels through on its way out of, or back into, the app.
 *
 * **Including the two surfaces a person actually clicks** (CodeRabbit, PR #191).
 * The first version of this list stopped at the API and the converter, which
 * left the easiest way to break the promise uncovered: a `free`-only condition
 * on either control hides it without touching a single file below the UI. The
 * gate box says *no entitlement anywhere on that path*, and a control nobody
 * can see is on that path.
 */
const EXPORT_PATH_FILES = [
  path.join(WEB, "src/app/api/v1/trips/[tripId]/export/route.ts"),
  path.join(WEB, "src/app/api/v1/trips/import/route.ts"),
  path.join(WEB, "src/components/home/ImportTripButton.tsx"),
  path.join(REPO, "packages/fixtures/src/bundle/fromTrip.ts"),
  // The download lives here…
  path.join(WEB, "src/components/trip/SettingsSheet.tsx"),
  // …and the upload on whichever of these two is on screen (M25 link 2).
  path.join(WEB, "src/app/(app)/page.tsx"),
  path.join(WEB, "src/components/home/FirstTripStart.tsx"),
];

/** Prose removed: a comment explaining a rule is the rule, not a breach. */
const codeOf = (file: string) => stripComments(readFileSync(file, "utf8"));

describe("nothing on the export or import path asks what somebody paid", () => {
  it("names no entitlement check", () => {
    for (const file of EXPORT_PATH_FILES) {
      const code = codeOf(file);
      // `accountCan` is the entitlement question's one spelling; `resolveEntitlements`
      // is the layer under it; `not-entitled` is the wire code a 402 carries.
      expect(code, file).not.toMatch(/\baccountCan\b/);
      expect(code, file).not.toMatch(/\bresolveEntitlements\b/);
      expect(code, file).not.toMatch(/\bnot-entitled\b/);
      expect(code, file).not.toMatch(/\bapi\.tokens\b/);
    }
  });

  // The positive half, so the sweep above cannot pass by the files being empty
  // or mis-pathed — the witness floor this repo's own guidance asks for. Each
  // line names something only that file has, so a wrong path fails here rather
  // than reporting a clean sweep of nothing.
  it("reads files that really are the export path, controls included", () => {
    const [exportRoute, importRoute, importButton, converter, sheet, home, firstRun] =
      EXPORT_PATH_FILES.map((f) => codeOf(f!));
    expect(exportRoute).toMatch(/tripToBundle/);
    expect(importRoute).toMatch(/bundleTripCommandGroups/);
    expect(importButton).toMatch(/v1\/trips\/import/);
    expect(converter).toMatch(/BundleStop/);
    // The download is a link to the endpoint, and the upload is this component
    // — on Home once there are trips, on the first-run card before that.
    expect(sheet).toMatch(/\/api\/v1\/trips\/\$\{tripId\}\/export/);
    expect(sheet).toMatch(/Download Trip/);
    expect(home).toMatch(/ImportTripButton/);
    expect(firstRun).toMatch(/ImportTripButton/);
  });
});

describe("no new entitlement and no new plan version", () => {
  // **M25 adds nothing to this list, and the list is the reason no plan version
  // is published.** ADR-045 rule 1: a change to what a plan *is* requires
  // publishing a version. Exporting a trip is not such a change, and this
  // asserts it rather than trusting it — a new member here in a diff that also
  // touches export is the milestone's own scope line being crossed.
  it("leaves Entitlement exactly as M22 left it", () => {
    expect([...ENTITLEMENTS].sort()).toEqual(
      ["ai.ask", "ai.command", "trip.collaborators", "api.tokens"].sort(),
    );
  });
});
