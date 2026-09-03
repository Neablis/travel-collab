import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { NotebookScreen } from "./NotebookScreen";
import { pageFixture } from "@tc/factories";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { makePagesHandlers } from "@/mocks/handlers";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => pushMock.mockClear());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("NotebookScreen", () => {
  it("lists the trip's notebooks by title", async () => {
    const overview = pageFixture({ id: "11111111-1111-4111-8111-111111111111", title: "Trip Overview" });
    const daySheet = pageFixture({ id: "22222222-2222-4222-8222-222222222222", title: "Day Sheet" });
    server.use(...makePagesHandlers([overview, daySheet]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // Scoped to the list: the gallery above offers a card called "Trip
    // Overview" too, because a seeded notebook is named after its template.
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText("Trip Overview")).toBeTruthy();
    expect(within(list).getByText("Day Sheet")).toBeTruthy();
    // A notebook has no scope to name (SPEC §18), so the badge #126 shipped
    // here must not come back. Removing the positive assertion only stopped
    // this test requiring the badge — it did not stop it passing WITH one,
    // which is the invariant the PR actually establishes (CodeRabbit on PR 129).
    expect(within(list).queryByText(/Trip-wide|Day \d/)).toBeNull();
  });

  it("creates a new page via the client and navigates to it", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Start from Blank notebook" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/trips/${TRIP_ID}/pages/`)));
  });

  it("renames a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onUpdate = vi.fn();
    server.use(...makePagesHandlers([page], { onUpdate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Rename ${page.title}` }));
    const input = screen.getByLabelText(`Rename ${page.title}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed Page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(page.id, expect.objectContaining({ title: "Renamed Page" })),
    );
    expect(await within(list).findByText("Renamed Page")).toBeTruthy();
  });

  it("deletes a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onDelete = vi.fn();
    server.use(...makePagesHandlers([page], { onDelete }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    const list = await screen.findByRole("region", { name: "Your notebooks" });
    expect(within(list).getByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Delete ${page.title}` }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(page.id));
    await waitFor(() => expect(within(list).queryByText(page.title)).toBeNull());
  });

  // SPEC §7's index half. Each of these asserts one thing the design asked for
  // that the flat list did not say — not that a component rendered.

  it("states the standfirst's promise that pages follow the plan", async () => {
    server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID })]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // The promise is the point: a notebook that follows the plan looks exactly
    // like one that does not until something moves.
    expect(await screen.findByText(/Move a day or a stop and every page here follows it/)).toBeTruthy();
  });

  it("tells the three provenances apart — seeded, the reader's own, and a collaborator's", async () => {
    const seeded = pageFixture({
      id: "11111111-1111-4111-8111-111111111111",
      tripId: TRIP_ID,
      title: "Trip Overview",
      actorId: SYSTEM_ACTOR_ID,
    });
    const mine = pageFixture({
      id: "22222222-2222-4222-8222-222222222222",
      tripId: TRIP_ID,
      title: "Packing",
      actorId: "dev-alice",
    });
    // The case that used to read "Yours": a notebook somebody ELSE on this
    // shared trip wrote. `actorId` alone cannot tell it from the reader's own,
    // which is why the route sends `viewerId` (Copilot, PR #126).
    const theirs = pageFixture({
      id: "33333333-3333-4333-8333-333333333333",
      tripId: TRIP_ID,
      title: "Bob's notes",
      actorId: "dev-bob",
    });
    server.use(...makePagesHandlers([seeded, mine, theirs], { viewerId: "dev-alice" }));

    render(<NotebookScreen tripId={TRIP_ID} />);

    expect(await screen.findByText(/Comes with your trip · edited/)).toBeTruthy();
    expect(screen.getByText(/^Yours · edited/)).toBeTruthy();
    expect(screen.getByText(/^From another traveler · edited/)).toBeTruthy();
  });

  it("dates each notebook relatively, not as a wall-clock timestamp", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    server.use(...makePagesHandlers([pageFixture({ tripId: TRIP_ID, updatedAt: threeHoursAgo })]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    // "3 hours ago" answers "is this stale?"; the locale timestamp it replaced
    // answered "at what second?", which nobody asks of a notebook.
    expect(await screen.findByText(/edited 3 hours ago/)).toBeTruthy();
  });

  it("offers the two template seeds and a blank, and creates from the seed's own content", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));
    const dayTemplate = DEFAULT_TEMPLATES.find((t) => t.key === "day-sheet")!;

    render(<NotebookScreen tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: `Start from ${dayTemplate.title}` }));

    // The seed's OWN context and content, not a blank doc with the seed's
    // name — the gallery is a second way to reach `templates.ts`, not a
    // second definition of what those templates contain.
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({
          title: dayTemplate.title,
          context: dayTemplate.buildContext(TRIP_ID),
          content: dayTemplate.content,
        }),
      ),
    );
  });
});
