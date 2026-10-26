import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SignInLoading from "./signin/loading";
import SignUpLoading from "./signup/loading";
import InviteLoading from "./invite/[token]/loading";
import SharedTripLoading from "./s/[token]/loading";

afterEach(cleanup);

// The front door's dynamic routes, whose links wait on a server round-trip,
// and without a boundary a link to one held the page it came from until it
// answered (M54 part 4). One set, so a route that loses its boundary is a red
// row here rather than a frozen page. `/demo` and its trips are prerendered
// and prefetched whole, so a boundary there would never show. Sign-in and
// sign-up were out for a while: their page streaming in under the root
// `<ViewTransition>` wiped a username typed before hydration. Only a path
// change animates now (`RouteViewTransition`), and `m15-front-door` passed
// 24 runs in 24 with them back (PR 601).
const ROUTES: [string, ComponentType][] = [
  ["/signin", SignInLoading],
  ["/signup", SignUpLoading],
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
});
