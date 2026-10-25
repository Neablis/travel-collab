import { describe, expect, it } from "vitest";
import { assertPublicAddress, guardedLookup, RemoteImageRefused, type Resolve } from "./guard";

// The SSRF guard (ADR-081 item 4) against a fake resolver: no test here asks
// DNS. One case per refused range, because a range dropped from the list is
// how a cover URL reaches the cloud metadata service or a database port.

/** A resolver that answers `addresses` for every host. */
const resolvesTo =
  (...addresses: string[]): Resolve =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

async function reasonFor(host: string, resolve: Resolve = resolvesTo()): Promise<string> {
  const refusal = await assertPublicAddress(host, resolve).then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal, host).toBeInstanceOf(RemoteImageRefused);
  return (refusal as RemoteImageRefused).reason;
}

describe("assertPublicAddress", () => {
  it.each([
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.20.0.1"],
    ["private 192.168/16", "192.168.1.1"],
    ["loopback 127/8", "127.0.0.1"],
    ["link-local 169.254/16, the cloud metadata address", "169.254.169.254"],
    ["CGNAT 100.64/10", "100.100.100.200"],
    ["multicast 224/4", "224.0.0.1"],
    ["unspecified 0.0.0.0", "0.0.0.0"],
    ["this-network 0/8", "0.1.2.3"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback ::1", "::1"],
    ["IPv6 unspecified ::", "::"],
    ["IPv6 unique-local fc00::/7", "fd12:3456::1"],
    ["IPv6 link-local fe80::/10", "fe80::1"],
    ["IPv6 multicast ff00::/8", "ff02::1"],
    ["IPv4-mapped IPv6 of a private address", "::ffff:10.0.0.1"],
    ["IPv4-mapped IPv6 of the metadata address, hex form", "::ffff:a9fe:a9fe"],
    ["NAT64 of a private address", "64:ff9b::a00:1"],
  ])("refuses a host resolving into %s", async (_range, address) => {
    expect(await reasonFor("images.example.com", resolvesTo(address))).toBe("private-address");
  });

  it("refuses when any one of a host's addresses is private, not only the first", async () => {
    expect(await reasonFor("images.example.com", resolvesTo("93.184.216.34", "10.0.0.5"))).toBe("private-address");
  });

  it.each([
    ["a literal IPv4", "127.0.0.1"],
    ["a bracketed literal IPv6, as URL.hostname gives it", "[::1]"],
    ["a bracketed IPv4-mapped literal", "[::ffff:7f00:1]"],
  ])("refuses %s without asking DNS", async (_what, host) => {
    const asked: string[] = [];
    const resolve: Resolve = async (name) => {
      asked.push(name);
      return [{ address: "93.184.216.34", family: 4 }];
    };
    expect(await reasonFor(host, resolve)).toBe("private-address");
    expect(asked).toEqual([]);
  });

  it("refuses a host that resolves to nothing", async () => {
    expect(await reasonFor("nowhere.example.com", resolvesTo())).toBe("unresolvable");
    const failing: Resolve = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await reasonFor("nowhere.example.com", failing)).toBe("unresolvable");
  });

  it("answers the addresses of a public host, IPv4 and IPv6", async () => {
    const resolve = resolvesTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946");
    await expect(assertPublicAddress("images.example.com", resolve)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    await expect(assertPublicAddress("93.184.216.34", resolve)).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("guardedLookup", () => {
  // The lookup the socket itself connects through, so the address checked is
  // the address connected to: a DNS answer that changes between the check and
  // the connection (rebinding) is checked again here, not trusted.
  const lookup = (resolve: Resolve, all: boolean) =>
    new Promise<{ error: Error | null; result: unknown }>((done) => {
      guardedLookup(resolve)("images.example.com", { all }, (error, result) => done({ error, result }));
    });

  it("refuses a private answer at connect time", async () => {
    const { error } = await lookup(resolvesTo("127.0.0.1"), true);
    expect(error).toBeInstanceOf(RemoteImageRefused);
    expect((error as RemoteImageRefused).reason).toBe("private-address");
  });

  it("hands the socket the checked addresses", async () => {
    expect((await lookup(resolvesTo("93.184.216.34"), true)).result).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(await lookup(resolvesTo("93.184.216.34"), false)).toEqual({ error: null, result: "93.184.216.34" });
  });
});
