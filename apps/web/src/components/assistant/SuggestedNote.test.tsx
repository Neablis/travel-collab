import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantSuggested, SuggestionChange } from "@tc/contracts";
import { SuggestedNote } from "./SuggestedNote";

// The trip the note sits in. `null` is the notebook, or a test with no trip.
let liveTrip: unknown = null;
vi.mock("@/components/trip/context/TripProvider", () => ({ useOptionalTrip: () => liveTrip }));

afterEach(() => {
  cleanup();
  liveTrip = null;
});

const SUGGESTION = "7d9a1f8e-0000-4000-8000-000000000001";
const change = (n: number, extra: Partial<SuggestionChange> = {}): SuggestionChange => ({
  id: `7d9a1f8e-0000-4000-8000-00000000010${n}`,
  suggestionId: SUGGESTION,
  tripId: "7d9a1f8e-0000-4000-8000-000000000009",
  authorId: "user_ana",
  note: null,
  createdAt: "2026-10-10T00:00:00.000Z",
  commands: [{ type: "AddDay", tripId: "7d9a1f8e-0000-4000-8000-000000000009", dayId: "7d9a1f8e-0000-4000-8000-000000000201" }],
  description: `Change ${n}`,
  status: "pending",
  dependsOn: [],
  resolvedBy: null,
  resolvedAt: null,
  via: "assistant",
  ...extra,
});
const suggested: AssistantSuggested = {
  suggestionId: SUGGESTION,
  changeCount: 3,
  snapshotId: null,
  snapshotName: null,
  skipped: [],
};

// A trip the reader can write to, with these pending changes; `stale` no longer apply.
function tripWith(pending: SuggestionChange[], acceptMany: ReturnType<typeof vi.fn>, stale: string[] = []) {
  liveTrip = {
    boardMode: "write",
    suggestionGhosts: { pending, stale: stale.map((changeId) => ({ changeId })) },
    suggestions: { acceptMany },
  };
}

// Mitchell's preview comment, 2026-10-10: the chat offers Accept all too, and
// it is the chip's — one call with every change that still applies.
describe("SuggestedNote — Accept all", () => {
  it("accepts every pending change that still applies in one call, and says it landed as one change", async () => {
    const acceptMany = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const [a, b, c] = [change(1), change(2, { dependsOn: [change(1).id] }), change(3)];
    tripWith([b, a, c], acceptMany, [c.id]);
    render(<SuggestedNote suggested={suggested} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept all" }));

    expect(acceptMany).toHaveBeenCalledTimes(1);
    expect(acceptMany).toHaveBeenCalledWith([a.id, b.id]);
    expect(screen.getByRole("status").textContent).toBe("Accepted as one change. Undo takes it all back.");
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
  });

  it("says the server's refusal and offers the button again", async () => {
    const acceptMany = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "no-longer-applies", message: "“Change 1” no longer applies, so nothing was accepted." },
    });
    tripWith([change(1)], acceptMany);
    render(<SuggestedNote suggested={suggested} />);

    await userEvent.click(screen.getByRole("button", { name: "Accept all" }));

    expect(screen.getByRole("alert").textContent).toBe("“Change 1” no longer applies, so nothing was accepted.");
    expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers nothing to a suggester, outside a trip, or with nothing left to accept", () => {
    const acceptMany = vi.fn();
    render(<SuggestedNote suggested={suggested} />);
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
    cleanup();

    tripWith([change(1)], acceptMany);
    (liveTrip as { boardMode: string }).boardMode = "suggest";
    render(<SuggestedNote suggested={suggested} />);
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
    cleanup();

    tripWith([], acceptMany);
    render(<SuggestedNote suggested={suggested} />);
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
    expect(screen.getByRole("group").textContent).toContain("Open the suggestions in the trip header");
  });
});
