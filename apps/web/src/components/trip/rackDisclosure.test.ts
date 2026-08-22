import { describe, expect, it } from "vitest";
import { rackDisclosure } from "./rackDisclosure";

const shut = { open: false, openedByDrag: false };

describe("rackDisclosure", () => {
  it("opens on drag start and records that the drag opened it", () => {
    expect(rackDisclosure(shut, { type: "dragStart" })).toEqual({ open: true, openedByDrag: true });
  });

  it("re-closes a drawer the drag opened", () => {
    const dragged = rackDisclosure(shut, { type: "dragStart" });
    expect(rackDisclosure(dragged, { type: "dragEnd" })).toEqual(shut);
  });

  it("leaves a drawer the user opened alone", () => {
    const byUser = rackDisclosure(shut, { type: "toggle" });
    const dragged = rackDisclosure(byUser, { type: "dragStart" });
    expect(rackDisclosure(dragged, { type: "dragEnd" })).toEqual({ open: true, openedByDrag: false });
  });

  it("hands ownership to the user if they toggle mid-drag", () => {
    const dragged = rackDisclosure(shut, { type: "dragStart" });
    const kept = rackDisclosure(dragged, { type: "toggle" });
    expect(rackDisclosure(kept, { type: "dragEnd" }).open).toBe(true);
  });

  it("keeps a drawer open once a stop is parked in it, whoever opened it", () => {
    // The monitor raises dragEnd for every drop, so a park has to survive the
    // dragEnd that re-closes a drag-opened drawer — otherwise the drawer shuts
    // over the stop the drop just put in it.
    const dragged = rackDisclosure(shut, { type: "dragStart" });
    const ended = rackDisclosure(dragged, { type: "dragEnd" });
    const parked = rackDisclosure(ended, { type: "parked" });
    expect(parked).toEqual({ open: true, openedByDrag: false });
    // And a later drag cannot take it away again.
    expect(rackDisclosure(rackDisclosure(parked, { type: "dragStart" }), { type: "dragEnd" })).toEqual(parked);
  });

  it("shuts again when the user toggles a drawer they opened themselves", () => {
    const byUser = rackDisclosure(shut, { type: "toggle" });
    expect(rackDisclosure(byUser, { type: "toggle" })).toEqual(shut);
  });
});
