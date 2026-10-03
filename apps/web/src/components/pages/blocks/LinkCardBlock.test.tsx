import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LinkCardPayload, MissingNotebookPayload } from "@tc/pages";
import { clearQueryCache } from "@/lib/queryCache";
import { makePagesHandlers } from "@/mocks/handlers";
import { useExternalInputs } from "../useExternalInputs";
import { LinkCardBlock, MissingNotebookBlock } from "./LinkCardBlock";
import { linkHref } from "./linkHref";

type Role = "owner" | "editor" | "viewer";
const accessBody = (tripId: unknown, myRole: Role) => ({
  access: { tripId, myRole, members: [{ userId: "dev-alice", role: myRole, name: null, email: null, image: null }], invites: [], collaboratorsEntitled: true },
});
const accessAs = (myRole: Role) =>
  http.get("/api/trips/:tripId/access", ({ params }) => HttpResponse.json(accessBody(params.tripId, myRole)));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearQueryCache();
});
afterAll(() => server.close());

// The internal link card (M30, ADR-056). What it SAYS is the resolver's and is
// pinned in `link.test.ts`; this is whether it goes anywhere, and where.

const TRIP = "11111111-1111-4111-8111-111111111111";
const PAGE = "22222222-2222-4222-8222-222222222222";
const DAY = "33333333-3333-4333-8333-333333333333";

const money: LinkCardPayload = {
  kind: "link-card",
  to: { kind: "notebook", pageId: PAGE },
  eyebrow: "Notebook",
  title: "Money",
  summary: "What the trip costs, day by day.",
};

describe("LinkCardBlock", () => {
  it("is one link to the notebook, named by what the card says", () => {
    render(<LinkCardBlock payload={money} tripId={TRIP} />);
    const link = screen.getByRole("link", { name: /Money/ });
    expect(link.getAttribute("href")).toBe(`/trips/${TRIP}/pages/${PAGE}`);
    expect(link.textContent).toContain("What the trip costs, day by day.");
  });

  // While the page is being edited, a click on a widget selects it for its
  // settings; navigating away would be the wrong answer to that click.
  it("does not navigate while the page is being edited", () => {
    render(<LinkCardBlock payload={money} tripId={TRIP} interactive={false} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("linkHref", () => {
  it("opens a notebook on its own route from the trip's", () => {
    expect(linkHref({ kind: "notebook", pageId: PAGE }, TRIP, `/trips/${TRIP}`)).toBe(`/trips/${TRIP}/pages/${PAGE}`);
    expect(linkHref({ kind: "notebook", pageId: PAGE }, TRIP, `/trips/${TRIP}/pages/${PAGE}`)).toBe(
      `/trips/${TRIP}/pages/${PAGE}`,
    );
  });

  // Mitchell, 2026-09-27, on the demo's "Also in this trip": *"i cant click
  // them"*. The notebook route is behind sign-in, so a board mounted anywhere
  // else opens the notebook in its own Overview tab, and the visitor stays on
  // the path their access came with.
  it("opens a notebook inside the demo, or an invite's look, rather than on its route", () => {
    expect(linkHref({ kind: "notebook", pageId: PAGE }, TRIP, "/demo")).toBe(`/demo?view=Overview&page=${PAGE}`);
    expect(linkHref({ kind: "notebook", pageId: PAGE }, TRIP, "/invite/tok/look")).toBe(
      `/invite/tok/look?view=Overview&page=${PAGE}`,
    );
  });

  // `/demo` and an invite's look mount the same board under another address,
  // and sending their visitor to `/trips/:id` would drop the access they read
  // it through.
  it("keeps a tab or a day on the board's own path, and goes to the trip from a notebook", () => {
    expect(linkHref({ kind: "view", view: "Map" }, TRIP, "/demo")).toBe("/demo?view=Map");
    expect(linkHref({ kind: "view", view: "Map" }, TRIP, `/trips/${TRIP}/pages/${PAGE}`)).toBe(`/trips/${TRIP}?view=Map`);
    expect(linkHref({ kind: "day", day: { kind: "dayId", dayId: DAY } }, TRIP, `/trips/${TRIP}`)).toBe(
      `/trips/${TRIP}?view=Plan&day=${DAY}`,
    );
  });
});

// A link to a default notebook the trip does not have (Mitchell, 2026-10-03):
// the card offers to add it, the owner's click adds that one notebook, and the
// page's cards hear about it.
describe("MissingNotebookBlock", () => {
  const missing: MissingNotebookPayload = {
    kind: "link-missing",
    seedKey: "money",
    title: "Money",
    description: "What it costs, day by day, against the budget.",
  };

  it("adds the notebook it names, and no other missing default, then has the page re-read its notebooks", async () => {
    server.use(accessAs("owner"), ...makePagesHandlers([]));
    const { result } = renderHook(() => useExternalInputs(TRIP, new Set(["notebooks"] as const)));
    await waitFor(() => expect(result.current.notebooks).toEqual({ state: "ready", value: { pages: [] } }));

    render(<MissingNotebookBlock payload={missing} tripId={TRIP} />);
    expect(screen.getByTestId("link-missing").textContent).toContain("Money");
    fireEvent.click(await screen.findByRole("button", { name: "Add Money" }));

    await waitFor(() => {
      const slot = result.current.notebooks;
      expect(slot?.state === "ready" ? slot.value.pages.map((p) => p.seedKey) : null).toEqual(["money"]);
    });
  });

  // Adding a default is the owner's on the server; a control it would refuse
  // is not offered. And in Editing a click selects the widget.
  it("offers no button to an editor, nor to the owner while the page is being edited", async () => {
    let asked = 0;
    server.use(
      http.get("/api/trips/:tripId/access", ({ params }) => {
        asked++;
        return HttpResponse.json(accessBody(params.tripId, asked === 1 ? "editor" : "owner"));
      }),
    );
    render(<MissingNotebookBlock payload={missing} tripId={TRIP} />);
    await waitFor(() => expect(asked).toBe(1));
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    clearQueryCache();

    render(<MissingNotebookBlock payload={missing} tripId={TRIP} interactive={false} />);
    await waitFor(() => expect(asked).toBe(2));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("link-missing").textContent).toContain("Money");
  });

  it("says why when the add is refused, and keeps the card", async () => {
    server.use(
      accessAs("owner"),
      http.post("/api/trips/:tripId/pages/defaults", () => HttpResponse.json({ error: "Someone else changed this trip. Retry." }, { status: 409 })),
    );
    render(<MissingNotebookBlock payload={missing} tripId={TRIP} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Money" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Someone else changed this trip. Retry.");
    expect(screen.getByRole("button", { name: "Add Money" })).toBeTruthy();
  });
});
