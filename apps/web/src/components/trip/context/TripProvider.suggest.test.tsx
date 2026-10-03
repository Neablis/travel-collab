import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { CreateSuggestionInput, TripCommand } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import { TripProvider, useTrip } from "./TripProvider";

// Suggest mode (spec §2.3, plan T6). Through MSW rather than a mocked
// apiClient, because the claim is about the WIRE: a suggester's edits must
// never reach a command route, by the sender, the pagehide flush or the
// unmount drain — only the suggestions route, and only when they press Send.

const DAY_A = "a1111111-1111-4111-8111-111111111111";
const DAY_B = "b2222222-2222-4222-8222-222222222222";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
  cleanup();
});
afterAll(() => server.close());

/** Every request to a command route, single or batch, whatever its outcome. */
function commandRequests() {
  const seen: string[] = [];
  server.events.on("request:start", ({ request }) => {
    if (new URL(request.url).pathname.includes("/commands")) seen.push(request.url);
  });
  return seen;
}

function Probe() {
  const { activeTrip, history, dispatch, draft } = useTrip();
  const tripId = activeTrip?.tripId ?? "";
  const pending = history?.entries.filter((e) => "pending" in e && e.pending).reverse() ?? [];
  return (
    <div>
      <span data-testid="days">{activeTrip?.days.length ?? 0}</span>
      <span data-testid="count">{draft?.count ?? "none"}</span>
      <span data-testid="draft-error">{draft?.error ?? "none"}</span>
      <ol aria-label="Unsent">
        {pending.map((e) => (
          <li key={e.batchId}>{e.description}</li>
        ))}
      </ol>
      <button onClick={() => void dispatch({ type: "AddDay", tripId, dayId: DAY_A })}>add-a</button>
      <button onClick={() => void dispatch({ type: "AddDay", tripId, dayId: DAY_B })}>add-b</button>
      <button onClick={() => void draft?.send("Two more days?")}>send</button>
      <button onClick={() => draft?.discard()}>discard</button>
    </div>
  );
}

async function mountAsSuggester(extra?: { onCommand?: (c: TripCommand) => void; onSuggestion?: (i: CreateSuggestionInput) => void }) {
  const fixture = tripDetailFixture();
  server.use(...makeTripHandlers(fixture, { myRole: "suggester", ...extra }));
  const view = render(
    <TripProvider tripId={fixture.tripId}>
      <Probe />
    </TripProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
  const confirmedDays = Number(screen.getByTestId("days").textContent);
  return { fixture, view, confirmedDays };
}

/** Lets any send the provider was going to make get as far as the network. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

describe("TripProvider — a suggester's edits are a draft", () => {
  it("shows the edit on the board and sends no command", async () => {
    const seen = commandRequests();
    const { confirmedDays } = await mountAsSuggester();

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));

    expect(screen.getByTestId("days").textContent).toBe(String(confirmedDays + 1));
    expect(screen.getByTestId("count").textContent).toBe("1");
    await settle();
    expect(seen).toEqual([]);
  });

  it("send posts every unit once, in order, then shows the confirmed trip again", async () => {
    const onSuggestion = vi.fn<(input: CreateSuggestionInput) => void>();
    const { fixture, confirmedDays } = await mountAsSuggester({ onSuggestion });

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    expect(onSuggestion).toHaveBeenCalledTimes(1);
    expect(onSuggestion.mock.calls[0]![0]).toEqual({
      units: [
        { commands: [{ type: "AddDay", tripId: fixture.tripId, dayId: DAY_A }] },
        { commands: [{ type: "AddDay", tripId: fixture.tripId, dayId: DAY_B }] },
      ],
      note: "Two more days?",
    });
    expect(screen.getByTestId("days").textContent).toBe(String(confirmedDays));
  });

  it("discard restores the confirmed trip and sends nothing", async () => {
    const seen = commandRequests();
    const onSuggestion = vi.fn();
    const { confirmedDays } = await mountAsSuggester({ onSuggestion });

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));
    expect(screen.getByTestId("days").textContent).toBe(String(confirmedDays + 2));
    fireEvent.click(screen.getByRole("button", { name: "discard" }));

    expect(screen.getByTestId("days").textContent).toBe(String(confirmedDays));
    expect(screen.getByTestId("count").textContent).toBe("0");
    await settle();
    expect(seen).toEqual([]);
    expect(onSuggestion).not.toHaveBeenCalled();
  });

  // W7: flushing would send the draft as commands, which the server refuses.
  it("sends nothing on pagehide or on leaving the trip", async () => {
    const seen = commandRequests();
    const { view } = await mountAsSuggester();

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    view.unmount();
    await settle();
    expect(seen).toEqual([]);
  });

  it("keeps the draft when a change no longer applies, and names it", async () => {
    await mountAsSuggester();
    server.use(
      http.post("/api/trips/:tripId/suggestions", () =>
        HttpResponse.json({ error: "A change no longer applies.", code: "does-not-apply", index: 1 }, { status: 422 }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "add-a" }));
    fireEvent.click(screen.getByRole("button", { name: "add-b" }));
    const second = screen.getAllByRole("listitem")[1]!.textContent!;
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(screen.getByTestId("draft-error").textContent).not.toBe("none"));
    expect(screen.getByTestId("draft-error").textContent).toBe(
      `“${second}” no longer applies to the trip as it is now. Nothing was sent.`,
    );
    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});
