import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverCredit } from "./CoverCredit";

const REFERRAL = "utm_source=caesura&utm_medium=referral";

describe("CoverCredit", () => {
  it("credits the photographer and Unsplash, both linked with the referral, each in a new tab", () => {
    render(<CoverCredit photo={{ photographerName: "Aiko Tanaka", photographerUrl: "https://unsplash.com/@aiko" }} />);

    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Photo by Aiko Tanaka on Unsplash")).toBeTruthy();
    const photographer = screen.getByRole("link", { name: "Aiko Tanaka" });
    const unsplash = screen.getByRole("link", { name: "Unsplash" });
    expect(photographer.getAttribute("href")).toBe(`https://unsplash.com/@aiko?${REFERRAL}`);
    expect(unsplash.getAttribute("href")).toBe(`https://unsplash.com/?${REFERRAL}`);
    for (const link of [photographer, unsplash]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener");
    }
  });

  // A stored credit is shown to everyone on the trip; a link off Unsplash
  // must not become one, whatever got past the write.
  it("links Unsplash itself, not a stored URL that is off unsplash.com", () => {
    render(<CoverCredit photo={{ photographerName: "Mallory", photographerUrl: "javascript:alert(1)" }} />);
    expect(screen.getByRole("link", { name: "Mallory" }).getAttribute("href")).toBe(`https://unsplash.com/?${REFERRAL}`);
  });
});
