// **Where to report a security problem: the one list.** `/.well-known/security.txt` writes
// each entry as a `Contact:` line and `/security`'s reporting section shows the same
// entries, so the two cannot name different people (M63 D13). Refresh `EXPIRES` in
// `security.txt/route.ts` when you re-read this list.

/** The page `security.txt` names as its `Policy:`: what we promise a reporter. On production's own host, not the deployment's. */
export const SECURITY_POLICY_URL = "https://caesura.today/security";

/** One way to reach us: what a person reads, and where it goes. */
export type SecurityContact = { label: string; href: string };

/** The security email, and nothing else: no repository is named anywhere a reader can see (M63 decision 18). */
export const SECURITY_CONTACTS: readonly SecurityContact[] = [
  { label: "Email mitchell@demarcosoftware.com", href: "mailto:mitchell@demarcosoftware.com" },
];
