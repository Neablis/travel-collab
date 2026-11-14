import type { Location } from "@tc/contracts";
import { hydrate, type TripState } from "@tc/domain";
import { tripDetailFactory } from "@tc/factories";
import type { BundleStop, BundleTrip } from "@tc/fixtures";
import { describe, expect, it, vi } from "vitest";

// The plan is pure; only `planBundleLocationReconcile` reads the database.
vi.mock("./db/client", () => ({ db: {} }));
const { planLocationReconcileFromState } = await import("./bundleLocationReconcile");

const KYOTO: Location = { name: "Kyoto Station", city: "Kyoto", countryCode: "JP", lat: 34.9858, lng: 135.7588 };
const NARA: Location = { name: "Nara Station", city: "Nara", countryCode: "JP" };
const NARA_PINNED: Location = { ...NARA, lat: 34.6806, lng: 135.8195 };
const TITLE = "Train to Nara";

/** A one-day, one-stop trip whose stop is `kind` and sits at `location` → `endLocation`. */
function tripWith(kind: "transit" | "planned", endLocation: Location | null): { state: TripState; activityId: string } {
  const detail = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 1 } });
  const activityId = detail.days[0]!.activityIds[0]!;
  const activity = detail.activities[activityId]!;
  detail.activities[activityId] = {
    ...activity,
    title: TITLE,
    kind,
    location: KYOTO,
    mode: kind === "transit" ? "train" : null,
    endLocation,
  };
  return { state: hydrate(detail), activityId };
}

function bundleWith(stop: Omit<BundleStop, "title">): BundleTrip {
  return { key: "nara", name: "Nara", startsInDays: 10, days: [{ stops: [{ title: TITLE, ...stop }] }], backlog: [] };
}

// KI-2026-09-25-n: the plan compared `location` alone, so a leg's corrected
// destination read as "no difference" and never reached an imported trip.
describe("planLocationReconcileFromState — a leg's endLocation", () => {
  it("plans an endLocation-only correction as one UpdateActivity carrying endLocation", () => {
    const { state, activityId } = tripWith("transit", NARA);
    const plan = planLocationReconcileFromState(
      state,
      bundleWith({ kind: "transit", mode: "train", location: KYOTO, endLocation: NARA_PINNED }),
      [],
    );
    expect(plan.unmatchedStops).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.command).toEqual({
      type: "UpdateActivity",
      tripId: state.tripId,
      activityId,
      endLocation: NARA_PINNED,
    });
    expect(plan.updates[0]).toMatchObject({ endFrom: NARA, endTo: NARA_PINNED });
  });

  it("plans nothing when the leg's destination already matches the file", () => {
    const { state } = tripWith("transit", NARA_PINNED);
    const plan = planLocationReconcileFromState(
      state,
      bundleWith({ kind: "transit", mode: "train", location: KYOTO, endLocation: NARA_PINNED }),
      [],
    );
    expect(plan.updates).toEqual([]);
  });

  it("carries both fields when the origin and the destination both moved", () => {
    const { state } = tripWith("transit", NARA);
    const origin = { ...KYOTO, lat: 34.9859 };
    const plan = planLocationReconcileFromState(
      state,
      bundleWith({ kind: "transit", mode: "train", location: origin, endLocation: NARA_PINNED }),
      [],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]!.command).toMatchObject({ location: origin, endLocation: NARA_PINNED });
  });

  // Whether a stop may have a destination depends on `kind`, which this does
  // not touch; sending one to a non-transit stop is refused by the decider and
  // would abort the whole import run.
  it("does not send an endLocation to a stop whose kind is no longer transit", () => {
    const { state } = tripWith("planned", null);
    const plan = planLocationReconcileFromState(
      state,
      bundleWith({ kind: "transit", mode: "train", location: KYOTO, endLocation: NARA_PINNED }),
      [],
    );
    expect(plan.updates).toEqual([]);
  });
});
