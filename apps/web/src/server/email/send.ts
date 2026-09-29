// **Transactional email, through Resend** — the whole of it.
//
// One function, `sendEmail`, and it NEVER THROWS. Every caller is a touchpoint
// that already succeeded without mail (an account was created, an invite was
// minted) and a message that failed to go out must not undo that: the invite
// link is still copied to the owner's clipboard, and the account still exists.
// So a failure is an answer (`{ sent: false, reason }`) and a loud log line,
// never an exception.
//
// **Unconfigured means off, not broken.** `RESEND_API_KEY` is set on Preview
// and Production in the Vercel dashboard (the Resend integration put it there)
// and nowhere else — a local checkout, `pnpm check` and the Playwright lane all
// run without it and send nothing. That is also why this talks to Resend's
// HTTP API with `fetch` rather than through its SDK: one POST is the entire
// surface we use.
//
// This module knows nothing about trips, invites or accounts. Callers hand it
// strings; the templates beside it build those strings (`templates.ts`).

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// A slow mail provider must not hold a sign-in or an invite hostage. Both
// callers await the send, so this bounds what a Resend outage costs them.
const SEND_TIMEOUT_MS = 5_000;

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where a reply goes — the inviter, for an invite. Omitted when unknown. */
  replyTo?: string | null;
  /** Which touchpoint this is, for the log line and Resend's own tagging. */
  tag: "welcome" | "trip-invite";
};

export type SendOutcome =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not-configured" | "undeliverable-address" | "rejected" | "failed" };

/**
 * The From header, from `RESEND_EMAIL_DOMAIN`.
 *
 * The variable is a domain verified in Resend (`caesura.today`, say), which
 * becomes `Caesura <hello@caesura.today>`. A value that already carries an `@`
 * is taken as the whole address, so the mailbox can be changed from the
 * dashboard without a deploy of this file. Null when unset: no sender, no send.
 */
export function fromAddress(): string | null {
  const configured = (process.env.RESEND_EMAIL_DOMAIN ?? "").trim();
  if (configured === "") return null;
  const address = configured.includes("@") ? configured : `hello@${configured}`;
  return `Caesura <${address}>`;
}

// RFC 2606 / RFC 6761 reserved names. Dev-login identities default to
// `dev+<name>@example.com` (`lib/authConfig.ts`), which is undeliverable by
// design — and Previews carry a real Resend key. Sending to these would only
// buy bounces, and bounces count against the sending domain's reputation.
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/** Could this address plausibly receive mail? Well-formed and not reserved. */
export function isDeliverable(address: string): boolean {
  const parts = address.trim().split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local === "" || domain === "" || /\s/.test(address)) return false;
  return !RESERVED_DOMAIN.test(domain);
}

/**
 * Send one email. Resolves with what happened; never rejects.
 *
 * `fetchImpl` is the test seam — the unit suite drives every branch through it
 * without a network.
 */
export async function sendEmail(email: Email, fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = fromAddress();
  if (apiKey === "" || from === null) return { sent: false, reason: "not-configured" };
  // The address is deliberately never logged — it is the one piece of PII
  // here, and the tag is enough to find the touchpoint that failed.
  if (!isDeliverable(email.to)) return { sent: false, reason: "undeliverable-address" };

  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        tags: [{ name: "touchpoint", value: email.tag }],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Resend's error body says why (an unverified domain, a bad key) and
      // carries no recipient data, so it is safe to log whole.
      const detail = await res.text().catch(() => "");
      console.error("email: Resend refused a send", { tag: email.tag, status: res.status, detail });
      return { sent: false, reason: "rejected" };
    }
    const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { sent: true, id: typeof body?.id === "string" ? body.id : null };
  } catch (error) {
    console.error("email: send failed", { tag: email.tag, error });
    return { sent: false, reason: "failed" };
  }
}
