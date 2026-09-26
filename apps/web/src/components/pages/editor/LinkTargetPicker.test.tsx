import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { clearQueryCache } from "@/lib/queryCache";
import { LinkTargetPicker } from "./LinkTargetPicker";

// The internal link's "smart search bar" (M30, ADR-056): it knows what the
// trip has, autocompletes over it, previews each option in a line, and stores
// ids. Driven the way a person drives it — focus, type, Enter.

const MONEY = "44444444-4444-4444-8444-444444444444";
const OVERVIEW = "55555555-5555-4555-8555-555555555555";

function trip(): TripDetail {
  const t = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1, startDate: "2026-10-12" } });
  return t;
}

const server = setupServer(
  http.get("/api/trips/:tripId/pages", ({ params }) =>
    HttpResponse.json({
      viewerId: "dev-alice",
      pages: [
        {
          id: OVERVIEW, tripId: params.tripId, title: "Overview", context: { tripId: params.tripId, kind: "overview" },
          createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:00:00.000Z", actorId: "system",
          preview: { firstLine: "Here is your itinerary.", widgetCount: 6 },
        },
        {
          id: MONEY, tripId: params.tripId, title: "Money", context: { tripId: params.tripId },
          createdAt: "2026-09-26T00:00:00.001Z", updatedAt: "2026-09-26T00:00:00.001Z", actorId: "system",
          preview: { firstLine: "What the trip costs, day by day, against the budget.", widgetCount: 2 },
        },
      ],
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearQueryCache();
});
afterAll(() => server.close());

describe("LinkTargetPicker", () => {
  it("opens on insert, searching the trip's notebooks, days and tabs, each with a line about it", async () => {
    render(<LinkTargetPicker id="to" label="Links to" value={undefined} detail={trip()} globals={null} onChange={() => {}} layout="stacked" />);
    const box = screen.getByRole("combobox", { name: "Links to" });
    // Focused as soon as it is on screen — inserting a link opens this.
    await waitFor(() => expect(box.matches(":focus")).toBe(true));
    await screen.findByRole("option", { name: /Money/ });
    for (const group of ["Notebooks", "Days", "Trip tabs"]) expect(screen.getByRole("group", { name: group })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Money/ }).textContent).toContain("What the trip costs, day by day");
    expect(screen.getAllByRole("option", { name: /^Day \d/ })).toHaveLength(2);
    expect(screen.getByRole("option", { name: /^Map/ })).toBeTruthy();
  });

  // Autocomplete, and what is WRITTEN: the notebook's id in a `LinkTarget`,
  // never its title or a URL. Seen red by writing the combobox's encoded
  // string through instead of decoding it.
  it("narrows as you type and stores the chosen notebook by id", async () => {
    const onChange = vi.fn();
    render(<LinkTargetPicker id="to" label="Links to" value={undefined} detail={trip()} globals={null} onChange={onChange} layout="stacked" />);
    await screen.findByRole("option", { name: /Money/ });
    const box = screen.getByRole("combobox", { name: "Links to" });
    fireEvent.change(box, { target: { value: "costs" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "MoneyWhat the trip costs, day by day, against the budget.",
    ]);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ kind: "notebook", pageId: MONEY });
  });

  it("stores a day by its id, and a tab by its name", async () => {
    const onChange = vi.fn();
    const t = trip();
    render(<LinkTargetPicker id="to" label="Links to" value={undefined} detail={t} globals={null} onChange={onChange} layout="stacked" />);
    const box = screen.getByRole("combobox", { name: "Links to" });
    fireEvent.change(box, { target: { value: "day" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "day", day: { kind: "dayId", dayId: t.days[1]!.dayId } });
    fireEvent.change(box, { target: { value: "calendar" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "view", view: "Calendar" });
  });

  it("shows a link to a deleted notebook as that, rather than as never set", () => {
    const gone = "66666666-6666-4666-8666-666666666666";
    render(
      <LinkTargetPicker id="to" label="Links to" value={{ kind: "notebook", pageId: gone }} detail={trip()} globals={null} onChange={() => {}} layout="stacked" />,
    );
    expect((screen.getByRole("combobox", { name: "Links to" }) as HTMLInputElement).value).toBe("A notebook that was deleted");
  });
});
