// I3 (final review): before this branch, Auth.js's own default sign-in page
// honoured `?callbackUrl=`, so a signed-out visitor deep-linking to
// `/trips/:id` landed back on that trip after signing in. `server/auth.ts`
// now points `pages.signIn` at our own `/signin` (AuthScreen.tsx), which
// hardcoded `callbackUrl: "/"` and never read the query param — a real
// behavioural regression this branch introduced, not a pre-existing gap.
//
// `callbackUrl` comes straight off the URL, so it is untrusted input handed
// to `next-auth/react`'s `signIn()`, which will happily redirect the browser
// there after auth succeeds. Only a same-origin relative path is safe to
// honour: it must start with a single `/` and must NOT start with `//`
// (`//evil.example` is a protocol-relative URL — the browser resolves it
// against the *current* protocol, e.g. `https://evil.example`, so it is an
// open-redirect vector even though it "starts with /"). Anything else falls
// back to `"/"`.
//
// CodeRabbit (PR #56, finding 2): also reject any input containing a
// backslash (e.g. `/\evil.example`, `/\/evil.example`). A prior review
// traced this and found it *not currently exploitable* — Auth.js's default
// redirect callback does `if (url.startsWith("/")) return
// \`${baseUrl}${url}\``, so the origin is fixed by the literal `/` prefix
// before any WHATWG backslash normalisation (browsers and some URL parsers
// treat `\` as equivalent to `/` in an authority position) could reinterpret
// it as a scheme-relative or absolute URL. That analysis still holds today.
// But that safety currently depends on a downstream implementation detail —
// Auth.js never gaining a custom `redirect` callback, and every parser in
// this chain continuing to agree on what "starts with /" means. A validator
// should reject the input outright rather than rely on something else,
// elsewhere, to neutralise it later — this is a parser-differential guard,
// not a currently-exploitable-bug fix, so don't "simplify" it away as
// redundant with the `//` check above; it isn't the same check.
export function safeCallbackUrl(raw: string | null): string {
  if (raw === null) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw;
}
