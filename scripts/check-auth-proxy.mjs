#!/usr/bin/env node
// Ask a deployment where it would send you to sign in with Google, and report
// whether Auth.js's redirect proxy (ADR-034, closing KI-50) is actually live
// on it.
//
// Why this exists rather than "just try signing in": the proxy is configured
// entirely by an environment variable that Coolify injects at BUILD/RUN time, so
// whether a given deployment has it is a property of when it was built, not of
// what the dashboard says today. The only honest way to know is to ask the
// deployment. A full OAuth round trip would answer too, but it needs a human,
// a Google account and a browser; this needs none of those and answers in
// one round trip.
//
// It reads the `redirect_uri` out of the authorization URL the deployment
// builds. That single parameter is the whole mechanism: a deployment with the
// proxy names PRODUCTION's callback (the one URI registered with Google);
// one without names its own (which Google has never heard of).
//
//   node scripts/check-auth-proxy.mjs https://<pr>.preview.caesura.today
//
// It then asks GOOGLE whether it accepts that redirect_uri, which is the only
// question KI-50 was ever about. That step needs no credentials — an
// unregistered URI is refused before any sign-in begins — and it is what makes
// this a check rather than an echo of our own configuration.
//
// What it still cannot prove: that production FORWARDS the callback back here.
// That needs a completed Google sign-in, and therefore a human.
//
// Previews are public (and NOINDEX), so no credential is sent.

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

// A non-JSON body is almost always a proxy or error page rather than this app;
// show its start so nobody debugs the wrong thing.
const asJson = async (res, what) => {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    fail(`${what} did not return JSON (HTTP ${res.status}).`, `First 200 bytes: ${body.slice(0, 200) || "(empty)"}`);
  }
};

const csrfRes = await get(`${base}/api/auth/csrf`, { redirect: "manual" }, `${base}/api/auth/csrf`);
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
