import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { TripHistory } from "@tc/contracts";
import { tripAccessFixture, tripMemberProfileFactory } from "@tc/factories";
import { PeopleProvider } from "@/components/pages/people";
import { clearQueryCache } from "@/lib/queryCache";
import { HistoryPanel } from "./HistoryPanel";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const history: TripHistory = {
  tripId: TRIP,
  canUndo: true,
  canRedo: false,
  entries: [
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b02",
      fromSeq: 2, toSeq: 2, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: "Added Day 1", undone: true,
    },
    {
      batchId: "7d9a1f8e-0000-4000-8000-000000000b01",
      fromSeq: 1, toSeq: 1, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
      origin: { kind: "user" }, description: 'Created trip "Rome"', undone: false,
    },
  ],
};

describe("HistoryPanel", () => {
  // HistoryPanel no longer owns its own open/toggle state or trigger button —
  // it's meant to render as a Popover's content (TripHeader owns the Popover
  // and its "History" trigger, #13), so entries render immediately.
  it("lists entries newest-first, marks undone, previews on click", () => {
    const onPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={null} onPreview={onPreview} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    const items = screen.getAllByTestId("history-entry");
    expect(items[0]!.textContent).toContain("Added Day 1");
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(items[0]!.querySelector("s, [style*='line-through']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Added Day 1/ }));
    expect(onPreview).toHaveBeenCalledWith(2);
  });

  it("bounds the entries list to a page size with a Show older affordance", () => {
    const manyEntries: TripHistory = {
      tripId: TRIP,
      canUndo: true,
      canRedo: false,
      entries: Array.from({ length: 25 }, (_, i) => ({
        batchId: `7d9a1f8e-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
        fromSeq: i + 1, toSeq: i + 1, actorId: "u1", occurredAt: "2026-07-08T00:00:00.000Z",
        origin: { kind: "user" as const }, description: `Change ${i}`, undone: false,
      })),
    };
    render(
      <HistoryPanel history={manyEntries} previewSeq={null} onPreview={() => {}} onExitPreview={() => {}} onRevert={() => {}} />,
    );
    expect(screen.getAllByTestId("history-entry")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(screen.getAllByTestId("history-entry")).toHaveLength(25);
  });

  // #16: while previewing a past version, the banner offers Revert plus an
  // exit control; the exit control is labelled "Dismiss" (was "Back to now",
  // which read as unobvious) and calls onExitPreview.
  it("in preview mode, Dismiss exits the preview", () => {
    const onExitPreview = vi.fn();
    render(
      <HistoryPanel history={history} previewSeq={1} onPreview={() => {}} onExitPreview={onExitPreview} onRevert={() => {}} />,
    );
    expect(screen.getByText(/Viewing version 1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert to here" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onExitPreview).toHaveBeenCalledOnce();
  });
});

// W11, W15: an accepted suggestion names who asked for it, from the trip's
// member profiles — the access read `PeopleProvider` shares — never from the
// history DTO, which carries no names.
describe("HistoryPanel — accepted suggestions", () => {
  const server = setupServer(
    http.get("/api/trips/:tripId/access", () =>
      HttpResponse.json({
        access: {
          tripId: TRIP,
          myRole: "owner",
          members: [
            { userId: "u1", role: "owner", name: "Alice", email: null, image: null },
            { userId: "u-sam", role: "suggester", name: "Sam", email: null, image: null },
          ],
          invites: [],
          collaboratorsEntitled: true,
        },
      }),
    ),
  );
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    cleanup();
  });
  afterAll(() => server.close());

  const accepted = (authorId: string, description: string, seq: number): TripHistory["entries"][number] => ({
    batchId: `7d9a1f8e-0000-4000-8000-0000000000c${seq}`,
    fromSeq: seq, toSeq: seq, actorId: "u1", occurredAt: "2026-10-03T00:00:00.000Z",
    origin: {
      kind: "suggestion",
      suggestionId: "7d9a1f8e-0000-4000-8000-0000000000d1",
      changeId: `7d9a1f8e-0000-4000-8000-0000000000e${seq}`,
      authorId,
    },
    description, undone: false,
  });

  it("says Suggested by the author, and a former traveler once they have left", async () => {
    render(
      <PeopleProvider tripId={TRIP}>
        <HistoryPanel
          history={{ ...history, entries: [accepted("u-gone", "Added Gelato", 4), accepted("u-sam", "Moved Ramen to Day 2", 3), ...history.entries] }}
          previewSeq={null}
          onPreview={() => {}}
          onExitPreview={() => {}}
          onRevert={() => {}}
        />
      </PeopleProvider>,
    );
    expect(await screen.findByRole("button", { name: /Moved Ramen to Day 2.*Suggested by Sam/ })).toBeTruthy();
    // Only once the members have been read again without them (3.1, below).
    expect(await screen.findByRole("button", { name: /Added Gelato.*Suggested by a former traveler/ })).toBeTruthy();
    // An ordinary edit is not attributed to anyone.
    expect(screen.getByRole("button", { name: /Added Day 1/ }).textContent).not.toContain("Suggested");
  });

  // M38: the author's line leads with their chip — the glyph they picked —
  // beside the name they chose.
  it("draws the author's chip beside the name they chose", async () => {
    server.use(
      http.get("/api/trips/:tripId/access", () =>
        HttpResponse.json({
          access: tripAccessFixture({
            tripId: TRIP,
            members: [
              tripMemberProfileFactory.build({ userId: "u1", role: "owner", name: "Alice" }),
              tripMemberProfileFactory.build({ userId: "u-sam", role: "suggester", name: "Sam", displayName: "Sammy", avatar: "sailboat", color: "rose" }),
            ],
          }),
        }),
      ),
    );
    render(
      <PeopleProvider tripId={TRIP}>
        <HistoryPanel
          history={{ ...history, entries: [accepted("u-sam", "Moved Ramen to Day 2", 3), ...history.entries] }}
          previewSeq={null}
          onPreview={() => {}}
          onExitPreview={() => {}}
          onRevert={() => {}}
        />
      </PeopleProvider>,
    );
    const row = await screen.findByRole("button", { name: /Moved Ramen to Day 2.*Suggested by Sammy/ });
    expect(row.innerHTML).toContain("lucide-sailboat");
  });

  // Review of #311, finding 3.1: the names are read once, so a suggester who
  // joined after that read was called "a former traveler". An author the
  // names do not hold is now asked about once, with a fresh read, and only an
  // author still missing from it has left.
  it("reads the members again for an author who joined after the first read, once", async () => {
    clearQueryCache();
    let reads = 0;
    const member = (userId: string, name: string) => ({ userId, role: "suggester", name, email: null, image: null });
    server.use(
      http.get("/api/trips/:tripId/access", () => {
        reads += 1;
        const members = [member("u1", "Alice"), ...(reads > 1 ? [member("u-nia", "Nia")] : [])];
        return HttpResponse.json({ access: { tripId: TRIP, myRole: "owner", members, invites: [], collaboratorsEntitled: true } });
      }),
    );
    const panel = (entries: TripHistory["entries"]) => (
      <PeopleProvider tripId={TRIP}>
        <HistoryPanel
          history={{ ...history, entries: [...entries, ...history.entries] }}
          previewSeq={null}
          onPreview={() => {}}
          onExitPreview={() => {}}
          onRevert={() => {}}
        />
      </PeopleProvider>
    );
    const { rerender } = render(panel([accepted("u-nia", "Added Gelato", 4)]));

    expect(await screen.findByRole("button", { name: /Added Gelato.*Suggested by Nia/ })).toBeTruthy();
    // A second entry by the same author asks nothing more. One by an author no
    // read will find is asked about once, then said to have left — though the
    // fresh names that read brings would otherwise ask again, and again.
    rerender(
      panel([accepted("u-gone", "Added Pasta", 6), accepted("u-nia", "Moved Ramen to Day 2", 5), accepted("u-nia", "Added Gelato", 4)]),
    );
    expect(await screen.findByRole("button", { name: /Moved Ramen to Day 2.*Suggested by Nia/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Added Pasta.*Suggested by a former traveler/ })).toBeTruthy();
    expect(reads).toBe(3);
  });

  // Review of #311 (CodeRabbit): a re-read that failed left its author marked
  // as asked, so they were never asked about again and stayed "Suggested" for
  // good. A failed read now leaves them to be asked again the next time the
  // authors change.
  it("asks again about an author whose re-read failed", async () => {
    clearQueryCache();
    let reads = 0;
    const member = (userId: string, name: string) => ({ userId, role: "suggester", name, email: null, image: null });
    server.use(
      http.get("/api/trips/:tripId/access", () => {
        reads += 1;
        if (reads === 2) return HttpResponse.json({ error: "unavailable" }, { status: 503 });
        const members = [member("u1", "Alice"), ...(reads > 2 ? [member("u-nia", "Nia")] : [])];
        return HttpResponse.json({ access: { tripId: TRIP, myRole: "owner", members, invites: [], collaboratorsEntitled: true } });
      }),
    );
    const panel = (entries: TripHistory["entries"]) => (
      <PeopleProvider tripId={TRIP}>
        <HistoryPanel
          history={{ ...history, entries: [...entries, ...history.entries] }}
          previewSeq={null}
          onPreview={() => {}}
          onExitPreview={() => {}}
          onRevert={() => {}}
        />
      </PeopleProvider>
    );
    const { rerender } = render(panel([accepted("u-nia", "Added Gelato", 4)]));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByRole("button", { name: /Added Gelato/ }).textContent).toContain("Suggested");

    // An entry by Alice, whom the names already hold, changes the authors but
    // asks about no one new, so only Nia being asked again can name her.
    rerender(panel([accepted("u1", "Added Pasta", 5), accepted("u-nia", "Added Gelato", 4)]));
    expect(await screen.findByRole("button", { name: /Added Gelato.*Suggested by Nia/ })).toBeTruthy();
  });
});
