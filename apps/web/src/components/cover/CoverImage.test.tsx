import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverImage, coverSrc } from "./CoverImage";

const unsplash = {
  urls: {
    raw: "https://images.unsplash.com/photo-1?ixid=abc",
    regular: "https://images.unsplash.com/photo-1?ixid=abc&w=1080",
    small: "https://images.unsplash.com/photo-1?ixid=abc&w=400",
  },
  alt: "Maples over a temple roof",
  photographerName: "Aiko Tanaka",
};

describe("CoverImage", () => {
  it("hotlinks Unsplash's own URLs, sized through imgix on the raw one", () => {
    render(<CoverImage photo={unsplash} sizes="100vw" />);
    const img = screen.getByRole("img", { name: "Maples over a temple roof" });
    expect(img.getAttribute("src")).toBe(unsplash.urls.regular);
    expect(img.getAttribute("srcset")?.split(", ")[0]).toBe(
      "https://images.unsplash.com/photo-1?ixid=abc&w=400&q=80&fm=jpg&fit=crop 400w",
    );
  });

  it("starts the imgix query on a raw URL that has none", () => {
    expect(coverSrc("/offline-covers/dunes.svg", 800)).toBe("/offline-covers/dunes.svg?w=800&q=80&fm=jpg&fit=crop");
  });

  // Unsplash sends both `null` and `""` for a photo nobody described.
  it.each([null, ""])("says who took the photo when Unsplash's description is %j", (alt) => {
    render(<CoverImage photo={{ ...unsplash, alt }} sizes="100vw" />);
    expect(screen.getByRole("img", { name: "Photo by Aiko Tanaka" })).toBeTruthy();
  });

  it("loads lazily unless it is told it is above the fold", () => {
    const { unmount } = render(<CoverImage photo={unsplash} sizes="100vw" />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("lazy");
    unmount();
    render(<CoverImage photo={unsplash} sizes="100vw" eager />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("eager");
  });
});
