import { describe, expect, it } from "vitest";
import { linkHref } from "./linkHref";

const TRIP = "11111111-1111-4111-8111-111111111111";

// M58 decision 1: a public notebook is reached by its token alone, from any
// route, so no trip or page id is in the address.
describe("linkHref for a public notebook", () => {
  it.each(["", "/trips/abc", "/n/other-token", "/demo"])("is /n/<token> from %j", (pathname) => {
    const href = linkHref({ kind: "public", token: "tok-1" }, TRIP, pathname);
    expect(href).toBe("/n/tok-1");
    expect(href).not.toContain(TRIP);
  });
});
