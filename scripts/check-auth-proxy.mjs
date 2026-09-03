#!/usr/bin/env node
// Ask a deployment where it would send you to sign in with Google, and report
// whether Auth.js's redirect proxy (ADR-034, closing KI-50) is actually live
// on it.
//
// Why this exists rather than "just try signing in": the proxy is configured
// entirely by an environment variable that Vercel injects at DEPLOY time, so
// whether a given deployment has it is a property of when it was built, not of
// what the dashboard says today. The only honest way to know is to ask the
// deployment. A full OAuth round trip would answer too, but it needs a human,
// a Google account and a browser that is past Deployment Protection; this
// needs none of those and answers in one round trip.
//
// It reads the `redirect_uri` out of the authorization URL the deployment
// builds. That single parameter is the whole mechanism: a deployment with the
// proxy names PRODUCTION's callback (the one URI registered with Google);
// one without names its own (which Google has never heard of).
//
//   node scripts/check-auth-proxy.mjs https://travel-collab-git-<branch>-<team>.vercel.app
//
// It then asks GOOGLE whether it accepts that redirect_uri, which is the only
// question KI-50 was ever about. That step needs no credentials — an
// unregistered URI is refused before any sign-in begins — and it is what makes
// this a check rather than an echo of our own configuration.
//
// What it still cannot prove: that production FORWARDS the callback back here.
// That needs a completed Google sign-in, and therefore a human.
//
// Preview deployments sit behind Vercel Deployment Protection. Set
// VERCEL_AUTOMATION_BYPASS_SECRET (get it with `vercel env pull`) and it is
// sent as the bypass header automatically; without it a protected deployment
// answers with Vercel's SSO page and this script says so rather than
// misreporting it as a configuration failure.

const EXPECTED_PROXY_ORIGIN = "https://caesura.today";
// The full URI, not just the origin. An origin-only comparison passes for any
// path on caesura.today — including a wrong one that never reaches Auth.js's
// callback — so it would report a working proxy for a broken
// AUTH_REDIRECT_PROXY_URL. The path is the half that has to be right.
const EXPECTED_PROXY_REDIRECT_URI = `${EXPECTED_PROXY_ORIGIN}/api/auth/callback/google`;

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/check-auth-proxy.mjs <deployment-url>");
  process.exit(2);
}

const base = new URL(target).origin;

const fail = (message, detail) => {
  console.error(`FAIL  ${message}`);
  if (detail) console.error(`      ${detail}`);
  process.exit(1);
};

/**
 * Is this a host of ours, and therefore one we may send the bypass secret to?
 *
 * `VERCEL_AUTOMATION_BYPASS_SECRET` unlocks EVERY protected deployment this
 * project has (`environments-and-deploys.md` says so in as many words), and
 * this script's only argument is a URL. Attaching the header to whatever the
 * caller typed means one mistyped or pasted host receives that credential —
 * an outbound secret leak caused by a diagnostic tool, which is a poor trade
 * for saving a comparison. So the allow-list is the gate, not the header.
 *
 * Deliberately narrow: `caesura.today`, and this project's own Vercel hosts,
 * which are all `travel-collab-…​.vercel.app`. A bare `.vercel.app` suffix
 * check would not do — that is every Vercel deployment on the internet.
 * HTTPS is required for the same reason; the secret must not cross plaintext.
 */
const isOurHost = (origin) => {
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return u.hostname === "caesura.today" ||
    (u.hostname.startsWith("travel-collab-") && u.hostname.endsWith(".vercel.app"));
};

// A network error is a normal outcome for a diagnostic whose only input is a
// URL — an unreachable host, DNS failure or TLS error otherwise surfaces as an
// uncaught stack trace, which reads like the script is broken rather than the
// host being wrong. Every fetch below goes through this.
const get = async (url, init, what) => {
  try {
    return await fetch(url, init);
  } catch (error) {
    fail(`Could not reach ${what}.`, `${error instanceof Error ? error.message : String(error)}\n      Check the URL is right and the host is up.`);
  }
};

const trusted = isOurHost(base);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (bypass && !trusted) {
  fail(
    `Refusing to send VERCEL_AUTOMATION_BYPASS_SECRET to ${base}.`,
    "That secret unlocks every protected deployment this project has, and this host is not one of ours (expected https://caesura.today or https://travel-collab-*.vercel.app). Re-run without the variable set if you meant to probe it unauthenticated.",
  );
}
const headers = bypass ? { "x-vercel-protection-bypass": bypass } : {};

// Vercel's SSO gate answers with an HTML page rather than an error status, so
// a JSON parse failure here is almost always protection rather than a broken
// deployment. Say which, so nobody debugs the wrong thing.
const asJson = async (res, what) => {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    // Deployment Protection announces itself three different ways depending on
    // how the request was made: a 401, a 302 to `vercel.com/sso-api` (which
    // `redirect: "manual"` leaves as an empty body), or an interstitial HTML
    // page. Recognise all three, because the remedy is the same and it is not
    // "the deployment is broken".
    const location = res.headers.get("location") ?? "";
    // Two DIFFERENT Vercel gates land here and they have opposite remedies, so
    // do not collapse them. Deployment Protection is an access check a secret
    // opens. The bot challenge (`x-vercel-mitigated: challenge`, HTTP 429) is a
    // proof-of-browser that no secret opens — it wants JavaScript, so the only
    // way past it is a real browser. Production sits behind the second one
    // (custom domains are excluded from SSO protection), which is why this
    // script is a preview tool and production is verified by hand.
    const challenged =
      res.headers.get("x-vercel-mitigated") === "challenge" ||
      body.includes("Vercel Security Checkpoint");
    const protectedByVercel =
      res.status === 401 ||
      location.includes("vercel.com/sso-api") ||
      body.includes("vercel.com/sso-api") ||
      body.includes("Vercel Authentication");
    fail(
      `${what} did not return JSON (HTTP ${res.status}).`,
      challenged
        ? "Vercel's bot challenge answered, not the app. No secret gets past it — it needs a real browser. This is expected on the production custom domain; run this against a preview host instead."
        : protectedByVercel
          ? "This looks like Vercel Deployment Protection. Set VERCEL_AUTOMATION_BYPASS_SECRET (`vercel env pull`) and retry."
          : `First 200 bytes: ${body.slice(0, 200) || "(empty)"}`,
    );
  }
};

const csrfRes = await get(`${base}/api/auth/csrf`, { headers, redirect: "manual" }, `${base}/api/auth/csrf`);
const { csrfToken } = await asJson(csrfRes, "GET /api/auth/csrf");
if (!csrfToken) fail("No csrfToken in /api/auth/csrf — is this a deployment of this app?");

// The CSRF cookie must come back with the POST or Auth.js rejects the sign-in
// before it ever builds an authorization URL.
const cookies = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

// `X-Auth-Return-Redirect` makes Auth.js answer with `{ url }` as JSON instead
// of a 302 (`@auth/core/index.js:108,138`), which is what lets this read the
// destination without following it.
const signinRes = await get(`${base}/api/auth/signin/google`, {
  method: "POST",
  redirect: "manual",
  headers: {
    ...headers,
    cookie: cookies,
    "content-type": "application/x-www-form-urlencoded",
    "X-Auth-Return-Redirect": "1",
  },
  body: new URLSearchParams({ csrfToken, callbackUrl: base }),
}, `${base}/api/auth/signin/google`);

const { url } = await asJson(signinRes, "POST /api/auth/signin/google");
if (!url) fail("Auth.js returned no URL for the google provider.", "Is AUTH_GOOGLE_ID set on this environment?");

const authorizeUrl = new URL(url);
if (authorizeUrl.origin !== "https://accounts.google.com") {
  fail(
    `Expected a Google authorization URL, got ${authorizeUrl.origin}${authorizeUrl.pathname}`,
    `Full URL: ${url}`,
  );
}

const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
if (!redirectUri) fail("The authorization URL carries no redirect_uri.", `Full URL: ${url}`);

const redirectOrigin = new URL(redirectUri).origin;
console.log(`deployment    ${base}`);
console.log(`redirect_uri  ${redirectUri}`);

// Ask Google directly. Everything above only establishes what WE send; this
// establishes whether the other party accepts it, which is the actual subject
// of KI-50 and the only thing that was ever broken. No credentials are
// involved: an unregistered redirect_uri is refused before any sign-in starts.
//
// Google answers 302 either way, so the status is not the signal — the
// Location is. A registered URI goes to `/v3/signin/identifier` (the real
// sign-in page); an unregistered one goes to `/signin/oauth/error` with a
// base64 `authError` that decodes to `redirect_uri_mismatch`.
const askGoogle = async (url) => {
  const res = await get(url, { redirect: "manual" }, "Google's authorization endpoint");
  const location = res.headers.get("location") ?? "";

  // Refusal is the one answer we can read precisely, so read it first.
  if (location.includes("/signin/oauth/error")) {
    let reason = "";
    try {
      const err = new URL(location).searchParams.get("authError") ?? "";
      reason = Buffer.from(err, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim();
    } catch {
      /* the error blob is best-effort detail, never the verdict */
    }
    return { verdict: "refused", location, reason };
  }

  // Acceptance must be RECOGNISED, not merely "not a refusal". Treating every
  // other answer as a pass is how a check goes falsely green: Google can
  // reply with a rate limit, a bot interstitial, a 5xx, or a 200 that is not a
  // redirect at all, and none of those say the redirect_uri is registered.
  const accepted =
    res.status >= 300 && res.status < 400 &&
    /^https:\/\/accounts\.google\.com\/(v\d+\/)?signin\//.test(location);
  if (accepted) return { verdict: "accepted", location };

  return {
    verdict: "inconclusive",
    location,
    reason: `HTTP ${res.status}${location ? ` -> ${location.slice(0, 120)}` : " with no Location header"}`,
  };
};

const google = await askGoogle(url);
console.log(
  `google        ${{ accepted: "accepts it", refused: "REFUSES it", inconclusive: "gave an answer this script cannot read" }[google.verdict]}`,
);
if (google.verdict === "refused") {
  fail(
    `Google refuses this redirect_uri.`,
    `${google.reason || google.location}\n      Register ${redirectUri} in the Google Cloud console, or fix AUTH_REDIRECT_PROXY_URL. See ADR-034.`,
  );
}
if (google.verdict === "inconclusive") {
  // Non-zero on purpose. The script's headline claim is "Google accepts it";
  // an answer it cannot classify does not support that claim, and exiting 0
  // here would turn a transient rate limit into a green check.
  fail(
    `Could not establish whether Google accepts this redirect_uri.`,
    `${google.reason}\n      This is often transient (rate limit or bot interstitial) — retry before concluding anything. It is NOT evidence of a misconfiguration.`,
  );
}

if (redirectOrigin === base) {
  // Production's own callback IS the registered URI, so a production
  // deployment builds the same authorization URL whether or not it holds
  // AUTH_REDIRECT_PROXY_URL. Nothing observable from outside separates the two
  // cases, and claiming otherwise would be the script lying. Say so.
  console.log(
    `\nINCONCLUSIVE  This deployment sends Google its own callback, which is what both a
              proxy and a non-proxy deployment do when they ARE the proxy origin.
              Whether it will forward a preview's callback is not externally
              observable. Run this against a PREVIEW instead — that is the case
              the proxy changes, and completing a sign-in there exercises this
              deployment's forwarding as a side effect.`,
  );
  process.exit(0);
}

if (redirectUri === EXPECTED_PROXY_REDIRECT_URI) {
  // Says only what was actually established. This script proves two things —
  // the URI this deployment generates, and that Google accepts it — and it
  // cannot prove the third, that production forwards the callback back here.
  // That needs a completed sign-in. Earlier wording claimed the forwarding
  // outright, which was the script asserting something it had not checked.
  console.log(
    `\nOK  This deployment sends Google production's callback URI, and Google accepts it.
    So nothing needs registering for this host — that is KI-50's fix working.

    STILL UNPROVEN: that production forwards the callback back to this host.
    Only a completed Google sign-in shows that. Open ${base}/signin and try it.`,
  );
  process.exit(0);
}

if (redirectOrigin === EXPECTED_PROXY_ORIGIN) {
  fail(
    `redirect_uri is on the right host but the wrong path: ${redirectUri}`,
    `Expected exactly ${EXPECTED_PROXY_REDIRECT_URI}. AUTH_REDIRECT_PROXY_URL should be production's auth base with no trailing slash and no extra path — "https://caesura.today/api/auth". See ADR-034.`,
  );
}

fail(
  `redirect_uri points at ${redirectOrigin}, not ${EXPECTED_PROXY_ORIGIN}.`,
  "AUTH_REDIRECT_PROXY_URL is missing from this deployment — most likely it was built before the variable was set. Redeploy it. See ADR-034.",
);
