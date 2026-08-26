import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripDetailFixture, historyFixture } from "@tc/factories";
import { formatMoney } from "@/components/lenses/formatMoney";

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

import Home from "./page";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

function tripSummaryFixture(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    tripId,
    name: "Japan",
    status: "active",
    members: [{ userId: "dev-alice", role: "owner" }],
    createdAt: "2026-07-08T12:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
});

describe("Home trip actions", () => {
  it("deletes a trip and offers an undo that restores it", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return jsonResponse({
          detail: tripDetailFixture({ tripId, name: "Japan" }),
          history: historyFixture(tripId),
        });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i })); // confirm dialog

    const toast = await screen.findByRole("status");
    expect(toast.textContent).toMatch(/deleted "japan"/i);

    await userEvent.click(within(toast).getByRole("button", { name: /undo/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/trips/${tripId}/commands`),
      expect.objectContaining({ body: expect.stringContaining('"RestoreTrip"') }),
    );
  });

  it("removes the row immediately on confirm, before the delete request resolves", async () => {
    let resolveDelete: (r: Response) => void;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i })); // confirm dialog

    // The DeleteTrip request is still in flight (we haven't resolved it yet),
    // but the row should already be gone from the list.
    await waitFor(() => expect(screen.queryByText("Japan")).toBeNull());

    resolveDelete!(
      jsonResponse({ detail: tripDetailFixture({ tripId, name: "Japan" }), history: historyFixture(tripId) }),
    );
    await screen.findByRole("status");
  });

  it("brings the row back and shows an error if the delete request fails", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/trips/${tripId}/commands`)) {
        return jsonResponse({ error: "concurrency-conflict" }, 409);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await screen.findByRole("alert");
    // Two "Japan"s now render: the next-trip hero heading and the trip-list
    // row link — assert the row link specifically survived the failed
    // delete (the hero also renders "Japan" as its `Heading level={2}`,
    // making a bare `getByText("Japan")` ambiguous).
    expect(screen.getByRole("link", { name: "Japan" })).toBeTruthy();
  });

  it("duplicates a trip and navigates to the copy", async () => {
    const newTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/trips/${tripId}/duplicate`)) {
        return jsonResponse({ tripId: newTripId }, 201);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for japan/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /duplicate/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/trips/${tripId}/duplicate`),
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/trips/${newTripId}`));
  });

  // Phase 7 Task 7.2 replaced the single-field New-trip Dialog with the
  // 4-step NewTripWizard, hosted in a Sheet titled "New trip" (same
  // accessible name the old Dialog had). "Create empty" is the wizard's
  // still-reachable name-only path (NewTripWizard.tsx), so this exercises
  // the same createTrip-fails-and-the-overlay-stays-open behavior the old
  // test covered, through the new control.
  it("shows the create-trip error inside the still-open New-trip sheet on failure", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/trips") && init?.method === "POST") {
        return jsonResponse({ error: "name already taken" }, 400);
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({ trips: [tripSummaryFixture()] });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /^new trip$/i }));

    const dialog = await screen.findByRole("dialog", { name: /new trip/i });
    await userEvent.type(within(dialog).getByLabelText("Trip name"), "Iceland");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create empty$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/name already taken/i);
    // The error is rendered inside the sheet's content, not as a sibling
    // that would be visually stranded behind the overlay.
    expect(within(dialog).getByRole("alert").textContent).toMatch(/name already taken/i);
    // The sheet must still be open — createTrip does not close it on failure.
    expect(screen.getByRole("dialog", { name: /new trip/i })).toBeTruthy();
  });

  // Regression (CI, PR #32): an earlier draft had "Create empty" navigate
  // straight to the new trip, same as the full wizard's "Create trip". That
  // broke every e2e spec built on the old single-field dialog's actual
  // behavior — close, refresh the list, stay put, then click the new
  // trip's own card to navigate. "Create empty" is explicitly that dialog's
  // escape hatch (NewTripWizard.tsx), so it keeps that exact behavior; only
  // the full wizard (dates/budget applied, "Create trip") navigates.
  it("stays on the trip list and shows the new trip after Create empty, without navigating", async () => {
    const newTripId = "1a2b3c4d-5e6f-4789-9abc-def012345678";
    let listCallCount = 0;
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/trips") && init?.method === "POST") {
        return jsonResponse({ tripId: newTripId }, 201);
      }
      if (url.endsWith("/api/trips")) {
        listCallCount += 1;
        const trips = listCallCount === 1 ? [] : [tripSummaryFixture({ tripId: newTripId, name: "Reykjavik" })];
        return jsonResponse({ trips });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /^new trip$/i }));
    const dialog = await screen.findByRole("dialog", { name: /new trip/i });
    await userEvent.type(within(dialog).getByLabelText("Trip name"), "Reykjavik");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create empty$/i }));

    expect(await screen.findByRole("heading", { name: "Reykjavik", level: 3 })).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Task 18: the head's "Start from a Playbook" link is a real navigation
  // control (unlike the /playbooks route it points to, which is entirely
  // Preview-shielded) — it must render outside any Preview region and carry
  // a real href, not merely appear in the markup.
  it("renders a real, navigable Start from a Playbook link outside any Preview region", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/trips")) return jsonResponse({ trips: [] });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    const link = await screen.findByRole("link", { name: /start from a playbook/i });
    expect(link.getAttribute("href")).toBe("/playbooks");
    expect(link.closest("[data-preview-id]")).toBeNull();
  });
});

// Task 4.1 (M10 Phase 4): TripCard's plannedOfBudget prop already renders
// correctly (TripCard.test.tsx) and NextTripHero already computes its own
// line from a real TripDetail fetch — but page.tsx is the caller for every
// grid card (NextTripHero and TripCard are siblings here, not caller/callee),
// so it must fetch each visible trip's own TripDetail and pass the computed
// line down itself.
describe("Home trip cards' planned-of-budget line", () => {
  const secondTripId = "9f8e7d6c-5b4a-3928-1716-0f1e2d3c4b5a";

  it("gives each visible trip card its own real planned-of-budget line once its TripDetail fetch resolves", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        return jsonResponse({
          trip: tripDetailFixture({
            tripId: secondTripId,
            budget: { amountMinor: 50_000, currency: "USD" },
            tripCostTotal: 12_500,
            budgetRemaining: 37_500,
          }),
        });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [tripSummaryFixture(), tripSummaryFixture({ tripId: secondTripId, name: "Peru" })],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // Second trip only ever appears in the grid (the hero renders the
    // first trip), so this line proves the grid card computed it itself
    // from its own real TripDetail fetch, not something threaded through
    // NextTripHero (which never renders or calls TripCard).
    expect(await screen.findByText(`${formatMoney(12_500, "USD")} planned of ${formatMoney(50_000, "USD")}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/trips/${secondTripId}`));
  });

  it("renders a grid card without a planned-of-budget line while its own TripDetail fetch is still pending or has failed (no fabricated or stale line)", async () => {
    let resolveSecond: (r: Response) => void;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve;
        });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [tripSummaryFixture(), tripSummaryFixture({ tripId: secondTripId, name: "Peru" })],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    // Scope to the Peru card's own block (not the whole page) — the first
    // trip's card and the hero both legitimately show "No budget yet" in
    // this fixture, which would otherwise make a page-wide assertion pass
    // for the wrong reason.
    const peruHeading = await screen.findByRole("heading", { name: "Peru" });
    const peruBlock = peruHeading.closest("div");
    expect(peruBlock).not.toBeNull();
    expect(within(peruBlock!).queryByText(/planned of/)).toBeNull();
    expect(within(peruBlock!).queryByText("No budget yet")).toBeNull();

    // Resolving with an error afterward must not retroactively fabricate one.
    resolveSecond!(jsonResponse({ error: "boom" }, 500));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/trips/${secondTripId}`)));
    expect(within(peruBlock!).queryByText(/planned of/)).toBeNull();
    expect(within(peruBlock!).queryByText("No budget yet")).toBeNull();
  });

  // Regression test: a genuine network-level failure (fetch() itself
  // rejecting -- offline, DNS, CORS -- not an HTTP-level { ok: false })
  // must not leave an earlier round's real line stranded on screen looking
  // current. Promise.all is fail-fast, so one rejected per-trip fetch used
  // to abort the whole round's .then(...), leaving whatever was set by the
  // previous successful round untouched.
  it("clears a real planned-of-budget line rather than leaving it stale when a later round's fetch rejects at the network level", async () => {
    const thirdTripId = "11112222-3333-4444-5555-666677778888";
    let secondTripCallCount = 0;
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/trips/${thirdTripId}/commands`)) {
        return jsonResponse({
          detail: tripDetailFixture({ tripId: thirdTripId, name: "Chile" }),
          history: historyFixture(thirdTripId),
        });
      }
      if (url.endsWith(`/api/trips/${secondTripId}`)) {
        secondTripCallCount += 1;
        if (secondTripCallCount === 1) {
          return jsonResponse({
            trip: tripDetailFixture({
              tripId: secondTripId,
              budget: { amountMinor: 50_000, currency: "USD" },
              tripCostTotal: 12_500,
              budgetRemaining: 37_500,
            }),
          });
        }
        // Second round: a network-level failure -- fetch() itself rejects,
        // not an HTTP error response.
        throw new Error("network down");
      }
      if (url.endsWith(`/api/trips/${thirdTripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId: thirdTripId, budget: null }) });
      }
      if (url.endsWith(`/api/trips/${tripId}`)) {
        return jsonResponse({ trip: tripDetailFixture({ tripId, budget: null }) });
      }
      if (url.endsWith("/api/trips")) {
        return jsonResponse({
          trips: [
            tripSummaryFixture(),
            tripSummaryFixture({ tripId: secondTripId, name: "Peru" }),
            tripSummaryFixture({ tripId: thirdTripId, name: "Chile" }),
          ],
        });
      }
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    const peruHeading = await screen.findByRole("heading", { name: "Peru" });
    const peruBlock = peruHeading.closest("div");
    expect(peruBlock).not.toBeNull();
    expect(
      await within(peruBlock!).findByText(`${formatMoney(12_500, "USD")} planned of ${formatMoney(50_000, "USD")}`),
    ).toBeTruthy();

    // Delete the third trip: this changes the visible trip-id set (Chile
    // drops out), triggering a new fetch round for the remaining trips --
    // the same kind of trip-added/removed/reordered trigger described in
    // the effect's own bug. Peru's own TripDetail fetch rejects in this
    // round.
    await userEvent.click(await screen.findByRole("button", { name: /trip actions for chile/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i })); // confirm dialog

    await waitFor(() => expect(secondTripCallCount).toBeGreaterThanOrEqual(2));
    // The stale line from round 1 must not survive a round whose fetch
    // rejected -- it must be cleared, not left showing outdated data.
    await waitFor(() => expect(within(peruBlock!).queryByText(/planned of/)).toBeNull());
  });
});

// Task 8.5: page head/rhythm — a date line above the title, and a real
// "All trips" heading + count above the grid.
describe("Home page head", () => {
  function renderHome(trips: TripSummary[] = [tripSummaryFixture()]) {
    fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/trips")) return jsonResponse({ trips });
      if (/\/api\/trips\/[^/]+$/.test(url)) return jsonResponse({ trip: tripDetailFixture({ tripId }) });
      return jsonResponse({ error: "unexpected" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    return render(<Home />);
  }

  it("heads the page with today's date above the title", () => {
    renderHome();
    expect(screen.getByTestId("page-date-line")).toBeTruthy();
  });

  // CodeRabbit (PR #35): the date line used to compute `new Date()` inline
  // during render, which — since Next.js still server-renders a "use
  // client" component's initial HTML — could disagree with the browser's
  // own clock across a timezone boundary and either throw a hydration
  // mismatch or, worse, silently show the WRONG day until some unrelated
  // re-render happened to overwrite it. The fix moves the computation into
  // a client-only effect (`dateLabel` starts `null`, so there's nothing for
  // a server render to get wrong), which this test can't observe directly
  // — React Testing Library's `render` flushes a synchronous, no-async-work
  // effect like this one before returning, so there's no "still empty"
  // window to catch here. What the test DOES lock in, which is the actual
  // property that matters: the label reflects the VIEWER's local calendar
  // date, not a UTC one, at an instant deliberately chosen to fall on
  // different calendar days in UTC vs. a real negative-offset timezone.
  it("renders the viewer's local date, not a UTC-shifted one, across a day boundary", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu"; // UTC-10, no DST -- far enough from UTC to guarantee a boundary crossing below
    try {
      vi.useFakeTimers();
      // 2026-03-02T05:00:00Z is already March 2nd in UTC, but still March
      // 1st in Honolulu -- exactly the class of instant where a
      // server-clock (often UTC) render and the viewer's own local render
      // would disagree if the date were computed eagerly.
      vi.setSystemTime(new Date("2026-03-02T05:00:00Z"));
      renderHome();
      const dateLine = screen.getByTestId("page-date-line");
      expect(dateLine.textContent).toMatch(/mar(ch)? 1, 2026/i);
      expect(dateLine.textContent).not.toMatch(/mar(ch)? 2, 2026/i);
      // The visible label is human-readable prose ("Sun, Mar 1, 2026"), but
      // <time> also wants a real machine-readable value alongside it
      // (CodeRabbit, PR #35) -- and that value must be the same LOCAL day
      // the label names, not a UTC one.
      expect(dateLine.getAttribute("datetime")).toBe("2026-03-01");
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTz;
    }
  });

  it("labels the trips grid", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "All trips" })).toBeTruthy();
  });

  it("shows a trip count line next to the All trips heading, singularized for one trip", async () => {
    renderHome([tripSummaryFixture()]);
    await screen.findByRole("heading", { name: "All trips" });
    expect(screen.getByText("1 trip")).toBeTruthy();
  });

  it("does not render the All trips heading when there are no trips to show", async () => {
    renderHome([]);
    await screen.findByText(/A name is enough to start/i);
    expect(screen.queryByRole("heading", { name: "All trips" })).toBeNull();
  });
});

describe("Home first-run experience", () => {
  it("welcomes a signed-in user who has no trips yet", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ trips: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    expect(await screen.findByText("Plan your first trip")).toBeDefined();
    expect(screen.getByText(/A name is enough to start/)).toBeDefined();
  });

  it("creates a first trip from a name alone", async () => {
    const created = { tripId, name: "Japan" };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse(created, 201);
      return jsonResponse({ trips: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "New trip" }));
    await userEvent.type(screen.getByLabelText(/trip name/i), "Japan");

    // Step 1 of 4 — "Create empty" is enabled by the name alone, which is why
    // M15 needs no separate one-field first-run screen (decision 3).
    await userEvent.click(screen.getByRole("button", { name: "Create empty" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/trips"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("Home unauthenticated visitor", () => {
  it("sends an unauthenticated visitor to the landing page", async () => {
    fetchMock = vi.fn(async () => jsonResponse({ error: "unauthenticated" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/welcome"));
  });
});
