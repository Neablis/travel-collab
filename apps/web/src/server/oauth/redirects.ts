// **Redirect URIs: what may be registered, and what counts as the same one**
// (ADR-083 §6, *Open redirect*).
//
// A redirect is where a code goes, so a loose match is an open redirect that
// hands someone's code to whoever registered the near miss. Matching is
// therefore on the raw strings, with no normalisation at all: a different case,
// a trailing slash, a percent-encoding or an explicit default port is a
// different redirect. The one exception is a loopback URI's port (RFC 8252
// §7.3), because a native app binds whatever port is free.

// On the raw string, never a parsed URL, so a loopback match is exactly as
// strict as every other one. `localhost`, `127.0.0.1` and `[::1]` (amendment H),
// lowercase `http` only, and the authority must end right after the port, which
// keeps `http://localhost@evil.example/` out.
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?=[/?]|$)(.*)$/;

export type RedirectCheck = { ok: true } | { ok: false; why: string };

/** May `uri` be registered as a redirect? The rules registration and a CIMD both apply. */
export function checkRedirectUri(uri: string): RedirectCheck {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ok: false, why: "does not parse as a URL" };
  }
  // On the string: `new URL` drops an empty `#`, which still says fragment.
  if (uri.includes("#")) return { ok: false, why: "has a fragment" };
  // `https://claude.ai@evil.example/` reads as claude.ai to a person and is not.
  if (url.username !== "" || url.password !== "") return { ok: false, why: "carries a user name or password" };
  if (url.protocol === "https:") return { ok: true };
  if (url.protocol === "http:" && LOOPBACK.test(uri)) return { ok: true };
  return { ok: false, why: "is not https, or http on localhost, 127.0.0.1 or [::1]" };
}

/** Is `uri` a loopback redirect: a program on the person's own computer. */
export function isLoopback(uri: string): boolean {
  return LOOPBACK.test(uri);
}

/** Is `presented` the redirect that was `registered`: the same string, or the same loopback URI on another port. */
export function redirectMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true;
  const a = LOOPBACK.exec(registered);
  const b = LOOPBACK.exec(presented);
  return a !== null && b !== null && a[1] === b[1] && a[2] === b[2];
}
