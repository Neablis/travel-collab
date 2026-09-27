import { describe, expect, it } from "vitest";
import { canonicalAddress, typedAddressesIn } from "./typedAddresses";

// The set `link.external` is checked against (ADR-057). What matters is both
// directions: an address the asker typed, however they typed it, is in it, and
// anything that is not an http(s) address they typed is not.

describe("typedAddressesIn", () => {
  it("finds an address typed with a scheme, with www., or as a bare host, without the sentence's punctuation", () => {
    const typed = typedAddressesIn(
      "Link https://example.com/a?b=1, then www.jreast.co.jp/e/pass. Also see visitkyoto.jp!",
    );
    expect(typed.list()).toEqual([
      "https://example.com/a?b=1",
      "https://www.jreast.co.jp/e/pass",
      "https://visitkyoto.jp/",
    ]);
  });

  it("matches an address the way a browser reads it, and nothing else", () => {
    const typed = typedAddressesIn("add www.jreast.co.jp/e/pass");
    expect(typed.has("https://www.jreast.co.jp/e/pass")).toBe(true);
    expect(typed.has("HTTPS://WWW.JREAST.CO.JP/e/pass")).toBe(true);
    expect(typed.has("https://www.jreast.co.jp/e/other")).toBe(false);
    expect(typed.has("https://evil.example/")).toBe(false);
  });

  it("finds nothing in a message with no address, and never a non-web scheme", () => {
    expect(typedAddressesIn("add a link to the rail pass, day 1.5 of the trip").list()).toEqual([]);
    expect(typedAddressesIn("javascript:alert(1)").has("javascript:alert(1)")).toBe(false);
    expect(canonicalAddress("javascript:alert(1)")).toBeNull();
    expect(canonicalAddress("localhost")).toBeNull();
  });
});
