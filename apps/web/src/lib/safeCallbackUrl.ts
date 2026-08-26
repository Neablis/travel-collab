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
export function safeCallbackUrl(raw: string | null): string {
  if (raw === null) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
