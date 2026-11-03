import { describe, expect, it } from "vitest";
import { ActivityUpdatedV1, BatchableCommand, TripCommand } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// M44 decision 1: a booking is on any kind of stop, bounded and its link validated.
const add = (fields: Record<string, unknown>) => ({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Dinner", ...fields });
const upd = (fields: Record<string, unknown>) => ({ type: "UpdateActivity", tripId: TRIP, activityId: A1, ...fields });

describe("a booking", () => {
  for (const [name, schema] of [["TripCommand", TripCommand], ["BatchableCommand", BatchableCommand]] as const) {
    it(`${name} takes one on a stop of any kind, with any of its parts`, () => {
      for (const kind of ["planned", "pending", "transit"]) {
        expect(schema.safeParse(add({ kind, booking: { confirmation: "XK29QP" } }))).toMatchObject({
          success: true, data: { booking: { confirmation: "XK29QP" } },
        });
      }
      expect(schema.safeParse(add({ booking: { provider: "Opentable", url: "https://example.com/r/1" } }))).toMatchObject({
        success: true, data: { booking: { provider: "Opentable", url: "https://example.com/r/1" } },
      });
    });

    it(`${name} sets one and clears it with null on an update`, () => {
      expect(schema.safeParse(upd({ booking: { confirmation: "XK29QP" } }))).toMatchObject({
        success: true, data: { booking: { confirmation: "XK29QP" } },
      });
      expect(schema.safeParse(upd({ booking: null }))).toMatchObject({ success: true, data: { booking: null } });
    });

    it(`${name} refuses a url that is not an http or https link`, () => {
      for (const url of ["javascript:alert(1)", "not a url", "ftp://example.com/x"]) {
        expect(schema.safeParse(upd({ booking: { url } })).success, url).toBe(false);
      }
    });
  }

  it("refuses a blank part and an over-long one rather than storing them", () => {
    expect(TripCommand.safeParse(upd({ booking: { confirmation: "  " } })).success).toBe(false);
    expect(TripCommand.safeParse(upd({ booking: { provider: "x".repeat(101) } })).success).toBe(false);
  });
});

it("a payload written before M44 reads as no booking", () => {
  const payload = { tripId: TRIP, activityId: A1, title: "Old", timeWindow: null, location: null, notes: null };
  expect(ActivityUpdatedV1.parse({ type: "ActivityUpdated", version: 1, payload }).payload).toMatchObject({ booking: null });
});
