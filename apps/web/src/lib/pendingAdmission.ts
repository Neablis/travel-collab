// The one cookie M11a's gate rides on, and the only place its attributes are
// written down. Three separate seams fill or read it — the `/signup` form
// (an invite code), `proxy.ts` (a pending trip-invite token), and
// `recordSignIn` (read and clear) — and the milestone's exit gate asserts
// httpOnly + SameSite=Lax + short-lived + cleared on both paths. Three hand-
// copied option objects is how one of them ends up non-httpOnly without
// anyone noticing, so they come from here instead.
//
// Deliberately dependency-free: `proxy.ts` runs in the Edge runtime with no
// database and no Node built-ins (ADR-024), so anything it imports has to be
// plain data.

export const PENDING_ADMISSION_COOKIE = "pending_admission";

// Ten minutes: long enough for a Google round trip including a fresh account
// creation, short enough that an admission credential does not outlive the
// sign-in that used it if `recordSignIn` never gets to clear it.
export const PENDING_ADMISSION_MAX_AGE_SECONDS = 600;

// The value goes straight into a `Set-Cookie` header on a request anyone can
// make (the signup form's Server Action is a public POST endpoint). The
// cookie writers on both sides URI-encode the value, so this is not a header-
// injection guard — it is a bound on how much attacker-chosen data a single
// unauthenticated request can push into a response header. Real codes and
// invite tokens are far shorter; nothing legitimate is refused by this.
export const PENDING_ADMISSION_MAX_LENGTH = 256;

export type PendingAdmissionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
};

// `secure` is decided from the request host rather than `NODE_ENV`, and the
// difference is load-bearing: `pnpm --filter web test:e2e:ci-like` runs a
// production build (`NODE_ENV=production`) served over plain http on
// localhost. Keyed on NODE_ENV this cookie would be marked Secure there, the
// browser would silently drop it, and every admission spec would fail with no
// visible cause. Keyed on the host, localhost gets a usable cookie and every
// deployed origin gets Secure.
export function pendingAdmissionCookieOptions(host: string | null): PendingAdmissionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_ADMISSION_MAX_AGE_SECONDS,
    secure: !isLocalhost(host),
  };
}

// Hostnames only — the port is stripped first, and an absent/blank Host header
// is treated as remote, so the failure mode of not knowing is the safe one.
function isLocalhost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1) // bracketed IPv6 literal: [::1]:3000
    : (host.split(":")[0] ?? "");
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

// Bounded, whitespace-trimmed, and empty-means-nothing. Returning `null`
// rather than an empty string matters at the call site: an empty write would
// still be a write, and it would clobber a trip-invite token `proxy.ts` had
// already stored for someone who arrived through `/invite/<token>` and then
// walked to `/signup`.
export function normalizePendingAdmission(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > PENDING_ADMISSION_MAX_LENGTH) return null;
  return trimmed;
}
