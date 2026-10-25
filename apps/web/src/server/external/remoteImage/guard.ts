import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

// The SSRF guard every server fetch of a cover URL goes through (ADR-081 item
// 4). A cover URL is chosen by whoever holds an editor token, so without this
// the server would fetch `http://169.254.169.254/` or a database port on
// their behalf. What it refuses is the address a host resolves to, not the
// name: `localtest.me` and friends resolve to loopback from a public name.

/** Why a remote image was refused. Part of the API's `cover-url-rejected` answer, so each is stable. */
export type RemoteImageRefusalReason =
  | "invalid-url"
  | "url-too-long"
  | "not-https"
  | "private-address"
  | "unresolvable"
  | "too-many-redirects"
  | "upstream-status"
  | "not-an-image"
  | "svg"
  | "too-large"
  | "timeout"
  | "unreachable"
  | "offline";

/** A remote image the guard or the fetcher would not take, and why. */
export class RemoteImageRefused extends Error {
  readonly reason: RemoteImageRefusalReason;
  constructor(reason: RemoteImageRefusalReason, detail?: string) {
    super(detail === undefined ? `remote image refused: ${reason}` : `remote image refused: ${reason} (${detail})`);
    this.name = "RemoteImageRefused";
    this.reason = reason;
  }
}

/** Every address a host name resolves to. Injected, so no test asks DNS. */
export type Resolve = (host: string) => Promise<LookupAddress[]>;

/** Every address `host` resolves to, from the system resolver, in its own order. */
export const resolveHost: Resolve = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, order: "verbatim" }, (error, addresses) => (error ? reject(error) : resolve(addresses))),
  );

// IPv4 is a denylist of every special-purpose block (RFC 6890) a fetch could
// reach something of ours through, or that is not a real host at all.
const V4_REFUSED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network", including the unspecified address
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT, which some clouds use internally
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the metadata service
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
] as const) {
  V4_REFUSED.addSubnet(network, prefix, "ipv4");
}

/** An IPv6 address's first two 16-bit groups, which is all the allowlist below reads. */
function leadingGroups(ip: string): [number, number] {
  const head = ip.split("::")[0]!;
  const groups = head === "" ? [] : head.split(":");
  return [parseInt(groups[0] ?? "0", 16), parseInt(groups[1] ?? "0", 16)];
}

/** Whether `ip` (a literal address, no brackets) is a public unicast address a fetch may reach. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !V4_REFUSED.check(ip, "ipv4");
  if (family !== 6) return false;
  const [first, second] = leadingGroups(ip);
  // IPv6 is an allowlist: global unicast (2000::/3) only. That leaves out
  // `::`, `::1`, unique-local fc00::/7, link-local fe80::/10, multicast
  // ff00::/8, and every form that embeds an IPv4 address the socket would
  // really connect to: IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96.
  if ((first & 0xe000) !== 0x2000) return false;
  // Inside it, the blocks that embed an IPv4 address or are not hosts:
  // 2001::/23 (IETF, including Teredo), 2001:db8::/32 and 3fff::/20
  // (documentation), and 2002::/16 (6to4).
  if (first === 0x2001 && second < 0x200) return false;
  if (first === 0x2001 && second === 0xdb8) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && second < 0x1000) return false;
  return true;
}

/**
 * Resolve `host` and refuse it unless every address it names is public. A
 * literal address (`URL.hostname` brackets IPv6) is judged as it is, without
 * DNS. Answers the addresses, so a caller can connect to exactly these.
 */
export async function assertPublicAddress(host: string, resolve: Resolve = resolveHost): Promise<LookupAddress[]> {
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const family = isIP(literal);
  const addresses =
    family !== 0
      ? [{ address: literal, family }]
      : await resolve(host).catch((error: unknown) => {
          throw new RemoteImageRefused("unresolvable", error instanceof Error ? error.message : undefined);
        });
  if (addresses.length === 0) throw new RemoteImageRefused("unresolvable", host);
  // Every address, not the first: a host answering one public and one
  // private address could be connected to either.
  const refused = addresses.find(({ address }) => !isPublicAddress(address));
  if (refused !== undefined) throw new RemoteImageRefused("private-address", `${host} -> ${refused.address}`);
  return addresses;
}

/**
 * A `lookup` for the socket itself (`https.request({ lookup })`), so the
 * address the guard checked is the address connected to. Checking a name and
 * then letting the socket resolve it again leaves a window a rebinding DNS
 * server answers public, then private, through.
 */
export function guardedLookup(resolve: Resolve = resolveHost): LookupFunction {
  return (hostname, options, callback) => {
    assertPublicAddress(hostname, resolve).then(
      (addresses) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: Error) => callback(error, ""),
    );
  };
}
