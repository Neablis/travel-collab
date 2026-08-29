#!/usr/bin/env node
/**
 * Walk a protected Vercel preview deployment in a real browser, from anywhere —
 * including a Claude Code cloud session, where three separate things had to be
 * solved before a single page would load. `docs/guidelines/cloud-agent-sessions.md`
 * records the whole diagnosis; this file is the executable half.
 *
 *   pnpm --filter web walk:preview <url> [path ...]
 *
 * `<url>` is either a plain preview URL (a bypass secret must then be in the
 * environment) or a `?_vercel_share=` URL. Paths default to `/`.
 *
 * ── Getting past Deployment Protection ────────────────────────────────────────
 * The project has Vercel Authentication on (`ssoProtection: all_except_custom_
 * domains`), so every preview 302s to `vercel.com/sso-api`. That 302 carries
 * Vercel's headers, not the app's — do not read it as a response from the app.
 * Two ways through, in preference order:
 *
 *   1. VERCEL_AUTOMATION_BYPASS_SECRET — the durable one, and the only one that
 *      works unattended in CI. Generate it once per project (Vercel → Settings →
 *      Deployment Protection → Protection Bypass for Automation) and it never
 *      expires. Sent as `x-vercel-protection-bypass`, with
 *      `x-vercel-set-bypass-cookie` so subresources are covered too.
 *   2. A `?_vercel_share=` URL, which any Vercel MCP session can mint with
 *      `get_access_to_vercel_url`. Expires in 23 hours and is per-deployment, so
 *      it suits an interactive session and not a scheduled job. One navigation
 *      redeems it and sets the cookie on the browser context; every later
 *      navigation is an ordinary one.
 *
 * ── Getting Chromium onto the network at all (cloud sessions) ─────────────────
 * Two container facts, neither of which affects a laptop:
 *
 *   a. Egress goes through the agent proxy, and Chromium does not read
 *      /etc/ssl/certs. Hosts the gateway inspects (github.com, most of the web)
 *      fail ERR_CERT_AUTHORITY_INVALID until the gateway's own CAs are trusted.
 *      certutil is not installed here, so the CAs are pinned by SPKI hash —
 *      computed from the certificates the environment itself installed. This
 *      trusts exactly those five certificates; it is not
 *      `--ignore-certificate-errors`, and it is not a blanket disable.
 *   b. `*.vercel.app` is on the gateway's TLS-inspection bypass list, so it is
 *      tunnelled rather than inspected — and the tunnel cannot carry Chromium's
 *      TLS 1.3 ClientHello, which runs ~1830 B once the post-quantum key share
 *      is in it. The upstream answers 39 B and resets, which surfaces as
 *      ERR_CONNECTION_RESET with no hint of a cause. Capping at TLS 1.2 shrinks
 *      the ClientHello below whatever the limit is and the tunnel carries it.
 *      Bisected: every `--disable-features=` spelling of the post-quantum flag
 *      still failed on Chromium 141, and `--ssl-version-max=tls1.2` passed.
 *      The cost is that the walk exercises TLS 1.2, so this script is not
 *      evidence about anything TLS-version-dependent. It says nothing about
 *      the app.
 *
 * Exits non-zero if any path fails to load, so it is usable as a check.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const CA_DIR = "/usr/local/share/ca-certificates";
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * SPKI hashes for the CAs the container installed for its egress gateway.
 * Returns "" off-container (no directory, no proxy, nothing to pin).
 */
function gatewayCaSpkiHashes() {
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
      // than failing the walk — the others still get us onto the network.
    }
  }
  return hashes.join(",");
}

const [target, ...paths] = process.argv.slice(2);
if (!target) {
  console.error("usage: walk-preview.mjs <preview-url> [path ...]");
  process.exit(2);
}
if (paths.length === 0) paths.push("/");

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const isShareUrl = new URL(target).searchParams.has("_vercel_share");
if (!bypass && !isShareUrl) {
  console.error(
    "No way past Deployment Protection: pass a ?_vercel_share= URL, or set\n" +
      "VERCEL_AUTOMATION_BYPASS_SECRET. See the header of this file.",
  );
  process.exit(2);
}

const args = ["--ssl-version-max=tls1.2"];
const spki = gatewayCaSpkiHashes();
if (spki) args.push(`--ignore-certificate-errors-spki-list=${spki}`);

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  // playwright-core wants a newer build number than the one on disk here, so
  // the path is explicit rather than resolved. `playwright install` cannot fix
  // that — the proxy 403s cdn.playwright.dev.
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
    : undefined,
  args,
});

const context = await browser.newContext(
  bypass
    ? {
        extraHTTPHeaders: {
          "x-vercel-protection-bypass": bypass,
          "x-vercel-set-bypass-cookie": "true",
        },
      }
    : {},
);

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().trim());
});
page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));

let failed = 0;

if (isShareUrl) {
  // Redeeming the share token is a navigation like any other; what it leaves
  // behind is the `_vercel_jwt` cookie the rest of the walk rides on.
  const res = await page.goto(target, { waitUntil: "domcontentloaded" });
  console.log(`redeem  ${res?.status()}  -> ${page.url()}`);
  const names = (await context.cookies()).map((c) => c.name);
  if (!names.includes("_vercel_jwt")) {
    console.error("share link did not set _vercel_jwt — it has probably expired (23h).");
    failed += 1;
  }
}

for (const path of paths) {
  const url = new URL(path, target).toString();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = res?.status() ?? 0;
    const landed = new URL(page.url()).pathname;
    const redirected = landed !== new URL(url).pathname ? `  -> ${landed}` : "";
    console.log(`${String(status).padEnd(4)} ${path}${redirected}   ${await page.title()}`);
    if (status >= 400 || page.url().includes("vercel.com/sso-api")) failed += 1;
  } catch (e) {
    console.log(`FAIL ${path}   ${e.message.split("\n")[0]}`);
    failed += 1;
  }
}

if (consoleErrors.length) {
  console.log(`\nconsole errors (${consoleErrors.length}, deduped):`);
  for (const e of [...new Set(consoleErrors)]) console.log(`  - ${e}`);
} else {
  console.log("\nconsole errors: none");
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
