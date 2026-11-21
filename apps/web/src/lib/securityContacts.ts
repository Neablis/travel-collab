// **Where to report a security problem: the one list.** `/.well-known/security.txt` writes
// each entry as a `Contact:` line and `/security`'s reporting section shows the same
// entries, so the two cannot name different people (M63 D13). Refresh `EXPIRES` in
// `security.txt/route.ts` when you re-read this list.

const REPO = "https://github.com/Neablis/travel-collab";

/** The page `security.txt` names as its `Policy:`: what we promise a reporter. On production's own host, not the deployment's. */
export const SECURITY_POLICY_URL = "https://caesura.today/security";

/** One way to reach us: what a person reads, and where it goes. */
export type SecurityContact = { label: string; href: string };

/** The maintainer first, because a reporter without access to the private repository has no other way in. */
export const SECURITY_CONTACTS: readonly SecurityContact[] = [
  { label: "Email mitchell@demarcosoftware.com", href: "mailto:mitchell@demarcosoftware.com" },
  { label: "Report it privately, if we have given you access", href: `${REPO}/security/advisories/new` },
  { label: "Report a bug that is not a security problem", href: `${REPO}/issues/new` },
];
