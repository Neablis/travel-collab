import { describe, expect, it } from "vitest";
import { shortPlace } from "./place";

describe("shortPlace", () => {
  it("prefers the structured city", () => {
    expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA", city: "Rochester" })).toBe("Rochester");
  });

  it("falls back to the first segment of the full label", () => {
    expect(shortPlace({ name: "Ugly Duck Coffee, Rochester, NY, USA" })).toBe("Ugly Duck Coffee");
  });

  it("is null for no location", () => {
    expect(shortPlace(null)).toBeNull();
    expect(shortPlace(undefined)).toBeNull();
  });
});
