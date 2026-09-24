import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import { MacroView } from "./MacroView";

// The ghost (notebook-widget-framework spec, "The ghost"), as a person sees it.
// Editing prints the SHAPE of the value; Reading keeps the short label it
// always had (Mitchell, 2026-09-24 — M14 "Decided" item 2).
//
// `MacroView` always hands resolvers a trip, and no registered widget binds two
// parts separately yet, so the registry is extended with `@tc/pages`' own
// two-part probe. Everything else — `renderMacro` included — is the real module.
vi.mock("@tc/pages", async (importOriginal) => {
  const real = await importOriginal<typeof import("@tc/pages")>();
  const { ghostProbe } = await import("../../../../../packages/pages/src/test-support/ghostProbe");
  real.MACRO_REGISTRY[ghostProbe.name] = ghostProbe as never;
  return real;
});

afterEach(cleanup);

const detail: TripDetail = scenarios.threeDayTrip();
const view = (params: Record<string, unknown>, editing: boolean, name = "test.ghostProbe") =>
  render(<MacroView detail={detail} context={{ tripId: detail.tripId }} name={name} params={params} editing={editing} />);

describe("MacroView — an unbound widget", () => {
  it("renders its ghost in Editing: the shape of each value, named as not set up", () => {
    const { container } = view({}, true);
    // The accessible name says what is missing, not the glyph: `$XXX` read
    // aloud tells a screen-reader user nothing.
    expect(screen.getByRole("img", { name: "place — not set up" }).textContent).toBe("———");
    expect(screen.getByRole("img", { name: "cost — not set up" }).textContent).toBe("$XXX");
    expect(container.textContent).toBe("We were at ——— — $XXX.");
    expect(screen.queryByText("choose a field")).toBeNull();
  });

  it("keeps the short placeholder in Reading, with no ghost", () => {
    const { container } = view({}, false);
    expect(screen.getByText("choose a field")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.textContent).not.toContain("$XXX");
  });

  it("fills in per part: a bound part is its real value while the rest stays ghosted", () => {
    const { container } = view({ place: "Kichi Kichi in Pontochō" }, true);
    expect(container.textContent).toBe("We were at Kichi Kichi in Pontochō — $XXX.");
    // The bound part is a value, not a ghost of one.
    expect(screen.queryByRole("img", { name: "place — not set up" })).toBeNull();
    expect(screen.getByRole("img", { name: "cost — not set up" })).toBeTruthy();
  });

  it("renders the real sentence once every part is bound", () => {
    const { container } = view({ place: "Kichi Kichi", cost: "$88.00" }, true);
    expect(container.textContent).toBe("We were at Kichi Kichi — $88.00.");
    expect(screen.queryByRole("img")).toBeNull();
  });

  // The first REGISTERED widget that reaches a ghost from a real page: `field`
  // with no field chosen. Its kind is unknown until one is, so the ghost is
  // `———` and says which choice is missing.
  it("ghosts the field widget with no field chosen in Editing, and keeps its label in Reading", () => {
    view({}, true, "field");
    expect(screen.getByRole("img", { name: "field — not set up" }).textContent).toBe("———");
    expect(screen.queryByText("choose a field")).toBeNull();
    cleanup();
    view({}, false, "field");
    expect(screen.getByText("choose a field")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  // Stale is not a ghost (the spec's inline rule 6): the widget IS bound, to a
  // day that is gone, and a ghost would send the author to bind it again.
  it("says a removed day was removed in Editing too, never as a ghost", () => {
    view({ day: { kind: "index", index: 99 } }, true, "cost");
    expect(screen.getByText("that day was removed")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
