import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SignInLoading from "./signin/loading";
import SignUpLoading from "./signup/loading";
import InviteLoading from "./invite/[token]/loading";
import SharedTripLoading from "./s/[token]/loading";
import DemoLoading from "./demo/loading";

afterEach(cleanup);

// The front door's dynamic routes each read on the server before they paint,
// and without a boundary a link to one held the page it came from until that
// read answered (M54 part 4). One set, so a front-door route that loses its
// boundary is a red row here rather than a frozen page.
const ROUTES: [string, ComponentType][] = [
  ["/signin", SignInLoading],
  ["/signup", SignUpLoading],
  ["/invite/[token]", InviteLoading],
  ["/s/[token]", SharedTripLoading],
  ["/demo", DemoLoading],
];

describe("the front door's loading boundaries", () => {
  it.each(ROUTES)("%s paints a skeleton region at the click", (_route, Loading) => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading the page" })).toBeTruthy();
  });
});
