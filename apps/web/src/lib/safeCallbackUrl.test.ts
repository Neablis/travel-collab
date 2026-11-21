import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

describe("safeCallbackUrl", () => {
  it("defaults to Home when there is no callbackUrl", () => {
    expect(safeCallbackUrl(null)).toBe("/home");
  });

  it("honours a same-origin relative path", () => {
    expect(safeCallbackUrl("/trips/abc-123")).toBe("/trips/abc-123");
  });

  // Open-redirect guard: a protocol-relative URL "starts with /" but the
  // browser resolves it against the current protocol (e.g. `//evil.example`
  // -> `https://evil.example`), so it must be rejected even though a naive
  // `startsWith("/")` check alone would accept it.
  it("rejects a protocol-relative URL", () => {
    expect(safeCallbackUrl("//evil.example")).toBe("/home");
    expect(safeCallbackUrl("//evil.example/phish")).toBe("/home");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeCallbackUrl("https://evil.example")).toBe("/home");
    expect(safeCallbackUrl("http://evil.example/trips/abc")).toBe("/home");
  });

  it("rejects a path that does not start with /", () => {
    expect(safeCallbackUrl("trips/abc-123")).toBe("/home");
    expect(safeCallbackUrl("")).toBe("/home");
  });

  it("rejects a javascript: or data: pseudo-URL", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/home");
    expect(safeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe("/home");
  });

  // Parser-differential guard: `/\evil.example` and `/\/evil.example` both
  // "start with a single /" and pass the `//` check above, but a backslash
  // in an authority position is treated as equivalent to `/` by some URL
  // parsers (WHATWG backslash normalisation), which could reinterpret them
  // as scheme-relative or absolute URLs downstream. Not exploitable through
  // Auth.js's current default redirect callback (it only ever prepends
  // `baseUrl` to a literal `/`-prefixed string), but the guard should not
  // depend on that staying true.
  it("rejects a callbackUrl containing a backslash", () => {
    expect(safeCallbackUrl("/\\evil.example")).toBe("/home");
    expect(safeCallbackUrl("/\\/evil.example")).toBe("/home");
  });

  // A browser strips tab and newline from a URL before parsing it, so "/<TAB>/evil.example"
  // resolves to "//evil.example", another origin, while looking like a plain path. The
  // session-expired route puts this value in a Location header for a signed-in visitor.
  it("rejects control characters that a browser strips before resolving", () => {
    expect(safeCallbackUrl("/\t/evil.example")).toBe("/home");
    expect(safeCallbackUrl(decodeURIComponent("/%09/evil.example"))).toBe("/home");
    expect(safeCallbackUrl("/\n/evil")).toBe("/home");
    expect(safeCallbackUrl("/\r/evil")).toBe("/home");
    expect(safeCallbackUrl("/trips/\u0000abc")).toBe("/home");
  });

  it("keeps a path with a query and a fragment", () => {
    expect(safeCallbackUrl("/trips/abc?tab=days#top")).toBe("/trips/abc?tab=days#top");
  });

  it("falls back to Home for a path too long to put in a redirect", () => {
    expect(safeCallbackUrl(`/trips/${"a".repeat(2048)}`)).toBe("/home");
    expect(safeCallbackUrl(`/${"a".repeat(2000)}`)).toBe(`/${"a".repeat(2000)}`);
  });
});
