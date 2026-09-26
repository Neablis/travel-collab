import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LinkCardPayload } from "@tc/pages";
import { LinkCardBlock } from "./LinkCardBlock";
import { linkHref } from "./linkHref";

afterEach(cleanup);

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
  openable: true,
};

describe("LinkCardBlock", () => {
  it("is one link to the notebook, named by what the card says", () => {
    render(<LinkCardBlock payload={money} tripId={TRIP} />);
    const link = screen.getByRole("link", { name: /Money/ });
    expect(link.getAttribute("href")).toBe(`/trips/${TRIP}/pages/${PAGE}`);
    expect(link.textContent).toContain("What the trip costs, day by day.");
  });

  // The demo's visitor and an invitee having a look cannot open a notebook
  // route: they see what it is, and are not handed a link into it. Seen red by
  // dropping the `openable` check from the link branch.
  it("names a notebook the reader cannot open without linking to it", () => {
    render(<LinkCardBlock payload={{ ...money, openable: false }} tripId={TRIP} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Money")).toBeTruthy();
  });

  // While the page is being edited, a click on a widget selects it for its
  // settings; navigating away would be the wrong answer to that click.
  it("does not navigate while the page is being edited", () => {
    render(<LinkCardBlock payload={money} tripId={TRIP} interactive={false} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("linkHref", () => {
  it("opens a notebook on its own route from anywhere", () => {
    expect(linkHref({ kind: "notebook", pageId: PAGE }, TRIP, "/demo")).toBe(`/trips/${TRIP}/pages/${PAGE}`);
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
