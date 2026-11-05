import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { scenarios } from "@tc/factories";
import { renderMacro, type WidgetContext } from "@tc/pages";
import { PublicNotebookScreen, type PublicNotebookViewProp } from "./PublicNotebookScreen";

afterEach(cleanup);

// M58 part 3. The screen draws what the server resolved and nothing else: there
// is no trip in the browser for it to read, so every test hands it outcomes the
// way `toPublicNotebookView` does, built here by the same `renderMacro`.

const trip = scenarios.threeDayTrip({
  conflicts: [{ id: "c1", kind: "time-overlap", severity: "warn", subjects: [], description: "Two stops overlap", resolutions: [] }],
});
const ctx = (publicTokenFor: WidgetContext["publicTokenFor"] = () => null): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null, now: null,
  external: { weather: { state: "pending" }, notebooks: { state: "ready", value: { pages: [
    { id: "11111111-1111-4111-8111-111111111111", seedKey: null, title: "Packing list", firstLine: "Socks", widgetCount: 0 },
    { id: "22222222-2222-4222-8222-222222222222", seedKey: null, title: "Surprise for Sam", firstLine: "Do not tell", widgetCount: 0 },
  ] } } },
  reader: "public", canChat: false, chat: null, soloTrip: false, publicTokenFor,
});

const resolve = (name: string, params: Record<string, unknown>, c: WidgetContext = ctx()) =>
  ({ type: "macro" as const, attrs: { name, outcome: renderMacro(c, name, params) } });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });

function view(content: unknown[]): PublicNotebookViewProp {
  return { title: "Our plan", content: content as PublicNotebookViewProp["content"], accents: { cities: {}, days: {} } };
}

describe("PublicNotebookScreen", () => {
  it("draws the title, the prose and a resolved widget from the outcomes it was handed", () => {
    render(
      <PublicNotebookScreen
        view={view([para(text("Heading to "), resolve("attribute", { field: "trip.name" })), { type: "heading", attrs: { level: 2 }, content: [text("Day by day")] }])}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Our plan" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Day by day" })).toBeTruthy();
    expect(screen.getByText(trip.name)).toBeTruthy();
  });

  it("draws a hidden widget as Not shared, and a repeat's lines from its outcome", () => {
    render(
      <PublicNotebookScreen
        view={view([
          para({ type: "macro", attrs: { name: "cost.chart", outcome: { status: "not-shared" } } }),
          { type: "repeat", attrs: { name: "day.rows", outcome: { status: "ok", lines: ["Day 1: Kyoto", "Day 2: Osaka"] } } },
          { type: "repeat", attrs: { name: "day.rows", outcome: { status: "not-shared" } } },
        ])}
      />,
    );

    expect(screen.getAllByText("Not shared")).toHaveLength(2);
    expect(screen.getByText("Day 1: Kyoto")).toBeTruthy();
    expect(screen.getByText("Day 2: Osaka")).toBeTruthy();
  });

  it("links a public notebook to its /n/ address and leaves a private one as plain text", () => {
    const publicTokenFor = (id: string) => (id === "11111111-1111-4111-8111-111111111111" ? "tok-public" : null);
    const link = (pageId: string) => resolve("link.internal", { to: { kind: "notebook", pageId } }, ctx(publicTokenFor));
    render(<PublicNotebookScreen view={view([para(link("11111111-1111-4111-8111-111111111111")), para(link("22222222-2222-4222-8222-222222222222"))])} />);

    const cards = screen.getAllByTestId("link-card");
    expect(within(cards[0]!).getByText("Packing list")).toBeTruthy();
    expect(cards[0]!.getAttribute("href")).toBe("/n/tok-public");
    expect(within(cards[1]!).getByText("Surprise for Sam")).toBeTruthy();
    expect(cards[1]!.getAttribute("href")).toBeNull();
  });

  it("makes an item row of an open widget plain text, since the trip it would open is not this reader's", () => {
    const outcome = renderMacro(ctx(), "open", {});
    expect(outcome.status).toBe("ok");
    render(<PublicNotebookScreen view={view([para({ type: "macro", attrs: { name: "open", outcome } })])} />);

    const list = within(screen.getByRole("list", { name: "What needs you" }));
    expect(list.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(list.queryAllByRole("link")).toHaveLength(0);
  });

  it("ends in the call to action and offers no way into the trip, to anyone", () => {
    render(<PublicNotebookScreen view={view([para(text("Hello"))])} />);

    const main = screen.getByRole("main");
    expect(within(main).getByRole("link", { name: "Start planning for free" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /open in the trip/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /join|request access|invite/i })).toBeNull();
  });
});
