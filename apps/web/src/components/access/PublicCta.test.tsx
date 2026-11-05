import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NEW_TRIP_PATH } from "@/lib/homePath";
import { normalizeSignupRef } from "@/lib/signupRef";
import { PublicCta } from "./PublicCta";

afterEach(cleanup);

// M58 decision 7: one band for `/n/`, `/s/` and `/demo/<slug>`, and its button is
// the whole growth loop, so where it goes is what is pinned.
describe("PublicCta", () => {
  it("sends a visitor to sign up as the public-notebook channel, to land in New trip", () => {
    render(<PublicCta />);

    const href = screen.getByRole("link", { name: "Start planning — free" }).getAttribute("href")!;
    const url = new URL(href, "http://caesura.test");
    expect(url.pathname).toBe("/signup");
    expect(normalizeSignupRef(url.searchParams.get("ref"))).toBe("public-notebook");
    expect(url.searchParams.get("callbackUrl")).toBe(NEW_TRIP_PATH);
  });

  it("offers no way into the trip it sits under", () => {
    render(<PublicCta />);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
