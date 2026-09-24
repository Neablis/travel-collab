/**
 * The launch recipe that gets a Playwright Chromium onto the network from
 * inside a Claude Code cloud container — extracted from `walk-preview.mjs`,
 * which discovered it and is now its only caller.
 *
 * **The e2e lane does not use it any more** (2026-09-24). No automated test may
 * talk to a real third party, so `playwright.config.ts` serves the map's
 * basemap from a fixture and resolves every non-app hostname to nothing; there
 * is no proxied host left for it to trust. It stays a separate module because
 * the reasoning below is long and is about the container, not about walking a
 * preview.
 *
 * ## The problem this solves
 *
 * Container egress goes through the agent proxy, which re-terminates TLS for
 * every host it inspects. Chromium does not read `/etc/ssl/certs`, so it does
 * not trust the proxy's certificate and every inspected host fails with
 * `net::ERR_CERT_AUTHORITY_INVALID`. `curl` is unaffected (it reads the CA
 * bundle), which is what made KI-49 read this as an egress-policy block for a
 * month: the host was always reachable; the browser just would not trust the
 * hop.
 *
 * From 2026-09-23 to 2026-09-24 the e2e lane passed this to its Chromium too,
 * because its two map specs fetched real tiles from `tiles.openfreemap.org`
 * and went red in every cloud session without it. They no longer fetch them.
 *
 * ## Why an SPKI pin and not `--ignore-certificate-errors`
 *
 * `--ignore-certificate-errors` and `ignoreHTTPSErrors: true` turn
 * verification OFF. `/root/.ccr/README.md` forbids that outright, and it would
 * make every future map "verification" in a cloud session meaningless in a way
 * nobody would notice — a green run proving nothing is worse than a red one.
 *
 * `--ignore-certificate-errors-spki-list` instead ADDS trust for specific
 * public keys, computed here from the certificates the container itself
 * installed into `/usr/local/share/ca-certificates`. Nothing else becomes
 * trusted, and a machine with no such certificates gets no flag at all.
 *
 * ## Why this is NOT gated on `process.env.CI`
 *
 * The obvious detector is the wrong one. `pnpm --filter web test:e2e:ci-like`
 * sets `CI=true` locally, and per CLAUDE.md rule 1 that is *the only lane
 * whose result counts* — so a `!CI` gate would withhold the fix from the
 * exact run anyone would act on, and leave the two map specs red in every
 * cloud session forever.
 *
 * The signal used instead is the container itself: an egress proxy in the
 * environment AND gateway certificates on disk. A GitHub Actions runner has
 * neither (`/usr/local/share/ca-certificates` exists there but is empty), so
 * CI keeps validating real certificates and nothing about its lane changes.
 *
 * ## Why `--ssl-version-max=tls1.2` is NOT here
 *
 * `walk-preview.mjs` needs that cap and says why: `*.vercel.app` is on the
 * gateway's TLS-inspection BYPASS list, so it is tunnelled rather than
 * inspected, and the tunnel cannot carry Chromium's TLS 1.3 ClientHello once
 * the post-quantum key share is in it.
 *
 * KI-49 assumed the cap would have to come along, and called that the reason
 * the recipe could not simply be copied — CI would silently stop exercising
 * TLS 1.3. Measured 2026-09-23, that assumption is wrong: a top-level
 * navigation to `https://tiles.openfreemap.org/styles/positron` returns 200
 * with the SPKI pin alone and no cap. The tile host is *inspected*, not
 * tunnelled, so it never meets the ClientHello limit. The cap stays where the
 * host that needs it is walked, and the e2e lane keeps TLS 1.3 everywhere —
 * in the container as well as in CI.
 *
 * ## Why no `executablePath` either
 *
 * Playwright resolves its own browser correctly here; `walk-preview.mjs`'s
 * header records what a hardcoded path cost the last time one was written
 * down. `.claude/hooks/session-start.sh` repairs the headless-shell link on
 * every start, which is the case a pin was originally reached for.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Where the container drops the CAs its egress gateway signs with. */
const CA_DIR = "/usr/local/share/ca-certificates";

/**
 * Base64 SHA-256 SPKI hashes for the CAs the container installed for its
 * egress gateway, comma-joined for `--ignore-certificate-errors-spki-list`.
 * Returns `""` off-container — no directory, no certificates, nothing to pin.
 *
 * Deliberately computed rather than checked in: the set has already changed
 * once (the header of `walk-preview.mjs` was written against five
 * certificates; this image carries six), and a stale literal would pin the
 * wrong keys while still looking like it worked.
 */
export function gatewayCaSpkiHashes() {
  let files;
  try {
    files = readdirSync(CA_DIR).filter((f) => f.endsWith(".crt"));
  } catch {
    return "";
  }
  const hashes = [];
  for (const f of files) {
    try {
      const der = execFileSync("openssl", ["x509", "-in", join(CA_DIR, f), "-pubkey", "-noout"]);
      const spki = execFileSync("openssl", ["pkey", "-pubin", "-outform", "der"], { input: der });
      const digest = execFileSync("openssl", ["dgst", "-sha256", "-binary"], { input: spki });
      hashes.push(digest.toString("base64"));
    } catch {
      // A certificate we cannot parse is one we cannot pin. Skip it rather
      // than failing — the others still get us onto the network.
    }
  }
  return hashes.join(",");
}

/**
 * Chromium `args` for wherever this is running: the gateway CA pin inside a
 * proxied container, and an empty list everywhere else.
 *
 * Both halves of the test matter. Without the proxy check a laptop that
 * happens to keep a corporate CA in `CA_DIR` would pin keys for a hop that
 * never happens; without the certificate check a proxied environment with
 * nothing installed would pass an empty `--…-spki-list=`, which Chromium
 * reads as "pin nothing" and is only ever noise in the process list.
 */
export function containerChromiumArgs() {
  const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
  if (!proxied) return [];
  const spki = gatewayCaSpkiHashes();
  return spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [];
}
