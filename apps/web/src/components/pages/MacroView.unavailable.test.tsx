import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import type { ExternalInputs } from "@tc/pages";
import { MacroView } from "./MacroView";

// No registered widget reads outside data until T24's weather block, so the
// registry is extended here with `@tc/pages`' own test probe: a widget that
// declares `needs: ["weather"]` and resolves through the real `readSlot`. The
// rest of `@tc/pages` — `renderMacro` included — is the real module.
vi.mock("@tc/pages", async (importOriginal) => {
  const real = await importOriginal<typeof import("@tc/pages")>();
  const { weatherProbe } = await import("../../../../../packages/pages/src/test-support/weatherProbe");
  real.MACRO_REGISTRY[weatherProbe.name] = weatherProbe as never;
  return real;
});

afterEach(cleanup);

// A located trip: `unavailable` means the trip HAS what the widget needs.
const detail: TripDetail = scenarios.threeDayTrip();
const view = (external?: ExternalInputs) =>
  render(<MacroView detail={detail} context={{ tripId: detail.tripId }} external={external} name="test.weatherProbe" params={{}} />);

describe("MacroView — a widget whose outside source did not answer (ADR-052)", () => {
  it("shows the quiet placeholder, with no control on it", () => {
    view({ weather: { state: "failed" } });
    expect(screen.queryByText("weather unavailable")).not.toBeNull();
    // Not the ghost's bind action, and not a retry: nothing here is the
    // author's to fix.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says it is loading while the request is in flight, and when no slot was handed", () => {
    view({ weather: { state: "pending" } });
    expect(screen.queryByText("loading weather")).not.toBeNull();
    cleanup();
    view();
    expect(screen.queryByText("loading weather")).not.toBeNull();
  });

  it("renders the value once it lands", () => {
    view({ weather: { state: "ready", value: { points: [] } } });
    expect(screen.queryByText("0 points")).not.toBeNull();
  });
});
