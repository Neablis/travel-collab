import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

describe("safeCallbackUrl", () => {
  it("defaults to / when there is no callbackUrl", () => {
    expect(safeCallbackUrl(null)).toBe("/");
  });

  it("honours a same-origin relative path", () => {
    expect(safeCallbackUrl("/trips/abc-123")).toBe("/trips/abc-123");
  });

  // Open-redirect guard: a protocol-relative URL "starts with /" but the
  // browser resolves it against the current protocol (e.g. `//evil.example`
  // -> `https://evil.example`), so it must be rejected even though a naive
  // `startsWith("/")` check alone would accept it.
  it("rejects a protocol-relative URL", () => {
    expect(safeCallbackUrl("//evil.example")).toBe("/");
    expect(safeCallbackUrl("//evil.example/phish")).toBe("/");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeCallbackUrl("https://evil.example")).toBe("/");
    expect(safeCallbackUrl("http://evil.example/trips/abc")).toBe("/");
  });

  it("rejects a path that does not start with /", () => {
    expect(safeCallbackUrl("trips/abc-123")).toBe("/");
    expect(safeCallbackUrl("")).toBe("/");
  });

  it("rejects a javascript: or data: pseudo-URL", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/");
    expect(safeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe("/");
  });
});
