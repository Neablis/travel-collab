import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripSummary } from "@tc/contracts";
import { tripDetailFixture, historyFixture } from "@/mocks/fixtures";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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
});
