import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import InviteLoading from "./invite/[token]/loading";
import SharedTripLoading from "./s/[token]/loading";
import DemoLoading from "./demo/loading";

afterEach(cleanup);

// The front door's routes that read before they paint, and without a boundary
// a link to one held the page it came from until that read answered (M54
// part 4). One set, so a route that loses its boundary is a red row here
// rather than a frozen page.
const ROUTES: [string, ComponentType][] = [
  ["/invite/[token]", InviteLoading],
  ["/s/[token]", SharedTripLoading],
  ["/demo", DemoLoading],
];

describe("the front door's loading boundaries", () => {
  it.each(ROUTES)("%s paints a skeleton region at the click", (_route, Loading) => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading the page" })).toBeTruthy();
  });

  // A boundary streams its page in behind the skeleton, and inside the root
  // layout's `<ViewTransition>` a username typed before that page hydrated
  // was wiped: `m15-front-door`'s "Enter submits the dev-login form once
  // hydrated" failed 2 runs in 8 with one, 0 in 8 without. These two pages
  // read only the URL and cookies, so there is no wait for one to cover.
  it.each(["signin", "signup"])("/%s has none, so its form is in the first HTML", (route) => {
    expect(existsSync(join(import.meta.dirname, route, "loading.tsx"))).toBe(false);
  });
});
