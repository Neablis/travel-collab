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
// Preview deployments sit behind Vercel Deployment Protection. Set
// VERCEL_AUTOMATION_BYPASS_SECRET (get it with `vercel env pull`) and it is
// sent as the bypass header automatically; without it a protected deployment
// answers with Vercel's SSO page and this script says so rather than
// misreporting it as a configuration failure.

const EXPECTED_PROXY_ORIGIN = "https://caesura.today";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/check-auth-proxy.mjs <deployment-url>");
  process.exit(2);
}

const base = new URL(target).origin;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers = bypass ? { "x-vercel-protection-bypass": bypass } : {};

const fail = (message, detail) => {
  console.error(`FAIL  ${message}`);
  if (detail) console.error(`      ${detail}`);
  process.exit(1);
};

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

const csrfRes = await fetch(`${base}/api/auth/csrf`, { headers, redirect: "manual" });
const { csrfToken } = await asJson(csrfRes, "GET /api/auth/csrf");
if (!csrfToken) fail("No csrfToken in /api/auth/csrf — is this a deployment of this app?");

// The CSRF cookie must come back with the POST or Auth.js rejects the sign-in
// before it ever builds an authorization URL.
const cookies = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

// `X-Auth-Return-Redirect` makes Auth.js answer with `{ url }` as JSON instead
// of a 302 (`@auth/core/index.js:108,138`), which is what lets this read the
// destination without following it.
const signinRes = await fetch(`${base}/api/auth/signin/google`, {
  method: "POST",
  redirect: "manual",
  headers: {
    ...headers,
    cookie: cookies,
    "content-type": "application/x-www-form-urlencoded",
    "X-Auth-Return-Redirect": "1",
  },
  body: new URLSearchParams({ csrfToken, callbackUrl: base }),
});

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

if (redirectOrigin === EXPECTED_PROXY_ORIGIN) {
  console.log(
    `\nOK  Redirect proxy is LIVE. Google will call back to production, which forwards here.\n    Nothing needs registering for this host.`,
  );
  process.exit(0);
}

fail(
  `redirect_uri points at ${redirectOrigin}, not ${EXPECTED_PROXY_ORIGIN}.`,
  "AUTH_REDIRECT_PROXY_URL is missing from this deployment — most likely it was built before the variable was set. Redeploy it. See ADR-034.",
);
