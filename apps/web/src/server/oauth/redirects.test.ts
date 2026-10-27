import { describe, expect, it } from "vitest";
import { checkRedirectUri, isLoopback, redirectMatches } from "./redirects";

// A redirect is where a code goes. Each case below is one way a loose rule
// hands a code to someone who registered a near miss (ADR-083 §6).

describe("checkRedirectUri", () => {
  it("takes https on any host", () => {
    expect(checkRedirectUri("https://example.com/cb")).toEqual({ ok: true });
  });

  it.each(["http://localhost/cb", "http://127.0.0.1:8080/cb", "http://[::1]:5555/cb"])(
    "takes http on loopback: %s",
    (uri) => expect(checkRedirectUri(uri)).toEqual({ ok: true }),
  );

  it.each([
    ["http on a public host", "http://example.com/cb"],
    ["http on a private address", "http://10.0.0.1/cb"],
    ["http with loopback only as userinfo", "http://localhost@evil.example/cb"],
    ["a fragment", "https://example.com/cb#frag"],
    ["an empty fragment", "https://example.com/cb#"],
    ["a user name", "https://claude.ai@evil.example/cb"],
    ["something that does not parse", "not a url"],
    ["a custom scheme", "myapp://cb"],
    ["javascript", "javascript:alert(1)"],
  ])("refuses %s", (_case, uri) => {
    expect(checkRedirectUri(uri).ok).toBe(false);
  });
});

describe("isLoopback", () => {
  it("is true for the three loopback hosts over http, and nothing else", () => {
    expect(["http://localhost:1/cb", "http://127.0.0.1/cb", "http://[::1]/cb"].map(isLoopback)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      ["https://localhost/cb", "http://localhost.evil.example/cb", "http://127.0.0.2/cb"].map(isLoopback),
    ).toEqual([false, false, false]);
  });
});

describe("redirect normalisation", () => {
  const registered = "https://example.com/oauth/cb";

  it("matches the exact string", () => {
    expect(redirectMatches(registered, registered)).toBe(true);
  });

  it.each([
    ["a trailing slash", "https://example.com/oauth/cb/"],
    ["a different case in the host", "https://EXAMPLE.com/oauth/cb"],
    ["a different case in the path", "https://example.com/OAuth/cb"],
    ["%2F for /", "https://example.com/oauth%2Fcb"],
    ["an explicit :443", "https://example.com:443/oauth/cb"],
    ["a userinfo part", "https://user@example.com/oauth/cb"],
    ["an extra query", "https://example.com/oauth/cb?x=1"],
  ])("refuses %s", (_case, presented) => {
    expect(redirectMatches(registered, presented)).toBe(false);
  });

  it("refuses localhost registered and 127.0.0.1 presented", () => {
    expect(redirectMatches("http://localhost/cb", "http://127.0.0.1/cb")).toBe(false);
  });

  it("ignores a loopback port, and only the port", () => {
    expect(redirectMatches("http://[::1]/cb", "http://[::1]:5555/cb")).toBe(true);
    expect(redirectMatches("http://127.0.0.1:1/cb", "http://127.0.0.1:2/cb")).toBe(true);
    expect(redirectMatches("http://127.0.0.1/cb", "http://127.0.0.1:2/cb/")).toBe(false);
  });

  // No URL can carry it, so a match would hand `new URL` a string it throws on
  // and turn the shown refusal into a 500.
  it("refuses a loopback port past 65535", () => {
    expect(redirectMatches("http://127.0.0.1/cb", "http://127.0.0.1:99999/cb")).toBe(false);
  });

  it("ignores no port off loopback", () => {
    expect(redirectMatches("https://example.com/cb", "https://example.com:8443/cb")).toBe(false);
  });
});
