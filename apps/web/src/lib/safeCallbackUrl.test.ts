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

  // Parser-differential guard: `/\evil.example` and `/\/evil.example` both
  // "start with a single /" and pass the `//` check above, but a backslash
  // in an authority position is treated as equivalent to `/` by some URL
  // parsers (WHATWG backslash normalisation), which could reinterpret them
  // as scheme-relative or absolute URLs downstream. Not exploitable through
  // Auth.js's current default redirect callback (it only ever prepends
  // `baseUrl` to a literal `/`-prefixed string), but the guard should not
  // depend on that staying true.
  it("rejects a callbackUrl containing a backslash", () => {
    expect(safeCallbackUrl("/\\evil.example")).toBe("/");
    expect(safeCallbackUrl("/\\/evil.example")).toBe("/");
  });
});
