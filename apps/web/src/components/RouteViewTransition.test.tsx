import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RouteViewTransition } from "./RouteViewTransition";

// What each render asked of the boundary. jsdom has no View Transitions API,
// so React's own `<ViewTransition>` would show nothing of its class.
const asked: (string | undefined)[] = [];
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ViewTransition: ({ default: kind, children }: { default?: string; children: React.ReactNode }) => {
    asked.push(kind);
    return children;
  },
}));
let pathname = "/trips/t1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  asked.length = 0;
  pathname = "/trips/t1";
});

// PR 601: a boundary that animated every transition started a view transition
// for a tab change or a page arriving, and the keys typed while the browser
// captured the page were lost.
describe("RouteViewTransition", () => {
  it("animates the render that changes the path, and no other", () => {
    const { rerender } = render(<RouteViewTransition>page</RouteViewTransition>);
    rerender(<RouteViewTransition>same path, new content</RouteViewTransition>);
    expect(asked).toEqual(["none", "none"]);

    asked.length = 0;
    pathname = "/trips/t1/pages/p1";
    rerender(<RouteViewTransition>next page</RouteViewTransition>);
    expect(asked).toEqual(["auto", "none"]);
  });
});
