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

  it("shows the create-trip error inside the still-open New-trip dialog on failure", async () => {
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
    await userEvent.type(within(dialog).getByLabelText(/trip name/i), "Iceland");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create trip$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/name already taken/i);
    // The error is rendered inside the dialog's content, not as a sibling
    // that would be visually stranded behind the Dialog's overlay.
    expect(within(dialog).getByRole("alert").textContent).toMatch(/name already taken/i);
    // Dialog must still be open — createTrip does not close it on failure.
    expect(screen.getByRole("dialog", { name: /new trip/i })).toBeTruthy();
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
