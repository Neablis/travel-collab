import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import InviteLoading from "./invite/[token]/loading";
import SharedTripLoading from "./s/[token]/loading";

afterEach(cleanup);

// The front door's dynamic routes, whose links wait on a server round-trip,
// and without a boundary a link to one held the page it came from until it
// answered (M54 part 4). One set, so a route that loses its boundary is a red
// row here rather than a frozen page. `/demo` and its trips are prerendered
// and prefetched whole, so a boundary there would never show.
const ROUTES: [string, ComponentType][] = [
  ["/invite/[token]", InviteLoading],
  ["/s/[token]", SharedTripLoading],
];

describe("the front door's loading boundaries", () => {
  it.each(ROUTES)("%s paints a skeleton region at the click", (_route, Loading) => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading the page" })).toBeTruthy();
  });

  // Each of these pages draws the front door's header above its content, so a
  // fallback without it dropped the header for the wait and pushed the page
  // down when it came back.
  it.each(ROUTES)("%s keeps the front door's header up while it waits", (_route, Loading) => {
    render(<Loading />);
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  // A trade, not a free choice. Both pages are rendered per request, and
  // sign-up with `?code=` also fetches the referral's link preview, so a link
  // to either holds the page it came from until the server answers. But a
  // boundary streams the page in behind the skeleton, and inside the root
  // layout's `<ViewTransition>` a username typed before that page hydrated
  // was wiped: `m15-front-door`'s "Enter submits the dev-login form once
  // hydrated" failed 2 runs in 8 with one, 0 in 8 without. A held click costs
  // less than lost input.
  it.each(["signin", "signup"])("/%s has none, so its form is in the first HTML", (route) => {
    expect(existsSync(join(import.meta.dirname, route, "loading.tsx"))).toBe(false);
  });
});
