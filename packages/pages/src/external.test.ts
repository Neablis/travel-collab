import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { externalNeedsOf, type ExternalInputs } from "./external";
import { getMacro } from "./registry";
import type { WidgetContext } from "./registry-types";
import { weatherProbe } from "./test-support/weatherProbe";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const ctx = (external?: ExternalInputs): WidgetContext => ({
  trip: { tripId: TRIP } as unknown as TripDetail,
  page: { tripId: TRIP },
  user: null,
  globals: null,
  today: "2026-09-24",
  ...(external ? { external } : {}),
});

describe("a widget that declares it needs weather (ADR-052)", () => {
  it("answers unavailable(source) when the weather request failed — not empty, not unbound", () => {
    expect(weatherProbe.resolve(ctx({ weather: { state: "failed" } }), {})).toEqual({
      status: "unavailable",
      reason: "source",
    });
  });

  it("answers unavailable(pending) while the request is in flight, and when no slot was handed at all", () => {
    expect(weatherProbe.resolve(ctx({ weather: { state: "pending" } }), {})).toEqual({
      status: "unavailable",
      reason: "pending",
    });
    // The server's `resolveMacro` and the assistant build contexts with no
    // `external`, and must never be read as "the source failed".
    expect(weatherProbe.resolve(ctx(), {})).toEqual({ status: "unavailable", reason: "pending" });
  });

  it("reads the value once the slot is ready", () => {
    expect(weatherProbe.resolve(ctx({ weather: { state: "ready", value: { points: [] } } }), {})).toEqual({
      status: "ok",
      value: "0 points",
    });
  });
});

describe("externalNeedsOf — which inputs a page asks for", () => {
  const lookup = (name: string) => (name === weatherProbe.name ? weatherProbe : getMacro(name));
  const macro = (name: string) => ({ type: "macro", attrs: { name, params: {} } });

  it("names weather when a widget declaring it sits anywhere in the document", () => {
    const doc = [{ type: "paragraph", content: [{ type: "text", text: "hi" }, macro(weatherProbe.name)] }];
    expect([...externalNeedsOf(doc, lookup)]).toEqual(["weather"]);
  });

  it("names nothing for a page of widgets that only read the trip — so no location leaves", () => {
    const doc = [{ type: "paragraph", content: [macro("cost"), macro("dates")] }, macro("nope.unknown")];
    expect(externalNeedsOf(doc, lookup).size).toBe(0);
  });
});
