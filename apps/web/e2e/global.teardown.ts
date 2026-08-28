import { request } from "@playwright/test";
import { existsSync } from "node:fs";
import { BASE_URL } from "../src/config";
import { E2E_TRIP_PREFIX } from "./tripNames";

// The storageState auth.setup.ts writes (see also playwright.config.ts's
// project `use`). Teardown runs as whoever that session belongs to, so the
// server's own owner check is the second half of the safety scoping below.
const STORAGE_STATE = ".auth/alice.json";

/**
 * Deletes the trips this run created.
 *
 * Before this, only m8 cleaned up after itself: every other spec minted a trip
 * against the shared dev user and left it there for good, ~14 per run. The
 * home grid issues one detail fetch per card (KI-28), so the debris made each
 * run slower than the last and kept moving the layout-settle timing the grid's
 * own specs depend on — a leak that manufactures flakiness rather than merely
 * wasting rows.
 *
 * **Two independent conditions guard every delete**, because getting this
 * wrong means deleting a real person's trips on a shared database:
 *
 *  1. the name carries `E2E_TRIP_PREFIX`, and
 *  2. the signed-in session is the trip's *owner* — checked here against the
 *     effective member list, and again server-side (DeleteTrip is owner-only
 *     in accessPolicy.ts's MINIMUM_ROLE table).
 *
 * `/api/trips` also returns trips merely *shared* with this user, which is
 * exactly the case condition 2 exists to exclude.
 *
 * Runs after every project, before playwright.config.ts's `webServer` is torn
 * down (Playwright teardown unwinds global hooks first, the webServer plugin
 * last) — so the API is still up.
 *
 * Deliberately never throws: a cleanup failure turning a green suite red would
 * be a worse bug than the leak. It is loud instead, on a line that names the
 * count, so "0 deleted" after a real run is visible rather than silent.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STORAGE_STATE)) {
    console.warn(`[e2e teardown] skipped: no ${STORAGE_STATE} — the "setup" project never ran.`);
    return;
  }

  const context = await request.newContext({ storageState: STORAGE_STATE });
  try {
    const session = await context
      .get(`${BASE_URL}/api/auth/session`)
      .then(async (r) => (r.ok() ? await r.json().catch(() => undefined) : undefined))
      .catch(() => undefined);
    const userId: unknown = session?.user?.id;
    if (typeof userId !== "string" || userId === "") {
      console.warn("[e2e teardown] skipped: saved session is not signed in; nothing cleaned up.");
      return;
    }

    const listed = await context.get(`${BASE_URL}/api/trips`);
    if (!listed.ok()) {
      console.warn(`[e2e teardown] skipped: GET /api/trips -> ${listed.status()}; nothing cleaned up.`);
      return;
    }
    const { trips } = (await listed.json()) as {
      trips: { tripId: string; name: string; members: { userId: string; role: string }[] }[];
    };

    const mine = trips.filter(
      (trip) =>
        trip.name.startsWith(`${E2E_TRIP_PREFIX} `) &&
        trip.members.some((member) => member.userId === userId && member.role === "owner"),
    );

    let deleted = 0;
    const failures: string[] = [];
    for (const trip of mine) {
      const response = await context.post(`${BASE_URL}/api/trips/${trip.tripId}/commands`, {
        data: { type: "DeleteTrip", tripId: trip.tripId },
      });
      if (response.ok()) deleted += 1;
      else failures.push(`${trip.name} -> ${response.status()}`);
    }

    console.log(
      `[e2e teardown] deleted ${deleted}/${mine.length} "${E2E_TRIP_PREFIX}" trip(s) owned by ${userId}.`,
    );
    // Known residue, not an oversight: m11-clone's copies are owned by "erin",
    // who has no saved storageState, so this pass cannot see them. They are two
    // rows per run on a list no spec's timing depends on — the KI-28 fan-out
    // this exists to stop is on the shared user's home grid.
    if (failures.length > 0) console.warn(`[e2e teardown] could not delete: ${failures.join(", ")}`);
  } finally {
    await context.dispose();
  }
}
