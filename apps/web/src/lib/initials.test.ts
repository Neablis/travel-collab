import { describe, expect, it } from "vitest";
import { initialsFor } from "./initials";

describe("initialsFor", () => {
  it("takes the first letter of each hyphen-separated part", () => {
    expect(initialsFor("dev-alice")).toBe("DA");
  });

  it("falls back to the first two characters when there's only one part", () => {
    expect(initialsFor("alice")).toBe("AL");
  });

  it("uppercases the result", () => {
    expect(initialsFor("bob-jones")).toBe("BJ");
  });

  it("falls back to ? for an id with no alphanumeric characters", () => {
    expect(initialsFor("---")).toBe("?");
  });
});
