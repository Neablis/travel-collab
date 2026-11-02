import { describe, expect, it } from "vitest";
import type { TripRole } from "@tc/contracts";
import { redactBookingFor } from "./bookingRedaction";

const full = { confirmation: "XK29QP", provider: "Opentable", url: "https://example.com/r/1" };

describe("redactBookingFor", () => {
  // A confirmation code is a credential: anyone holding it can often change or
  // cancel the booking. Below editor it must not survive a read.
  it.each<TripRole>(["editor", "owner"])("%s sees the whole booking", (role) => {
    expect(redactBookingFor(role)(full)).toEqual(full);
  });

  it.each<TripRole | null>(["viewer", "suggester", null])("%s keeps the provider and nothing else", (role) => {
    expect(redactBookingFor(role)(full)).toEqual({ provider: "Opentable" });
  });

  // A reader still learns the stop is booked, as the assistant's `booked` says.
  it("keeps a code-only booking as booked, with no provider", () => {
    expect(redactBookingFor("viewer")({ confirmation: "XK29QP" })).toEqual({ provider: null });
  });

  it("passes an absent booking through as it came", () => {
    expect(redactBookingFor("viewer")(null)).toBeNull();
    expect(redactBookingFor("viewer")(undefined)).toBeUndefined();
  });
});
