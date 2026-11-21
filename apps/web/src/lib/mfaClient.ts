import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { getCsrfToken } from "next-auth/react";
import type { SecondFactorProofBody } from "./mfaWire";

// The browser half of the second step (M62): the routes under `/api/mfa` and
// `/api/account/mfa` say what to ask the authenticator, and this asks it. Kept out
// of the components so the screens read as screens, and so the one thing that is
// easy to get wrong, telling the token what passed, is written once.

async function post(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

/**
 * Hands a server-minted proof to NextAuth's `update`, which is what makes the
 * session cookie say the second factor passed. That is `next-auth/react`'s own
 * `update()` written out: it needs a `SessionProvider` this app does not mount,
 * and what it sends is the CSRF token and the data. The proof is the only data
 * the `jwt` callback believes (`server/mfa/state.ts`); anything else is ignored.
 */
export async function applySecondFactorProof(proof: SecondFactorProofBody): Promise<boolean> {
  const csrfToken = await getCsrfToken();
  const { status } = await post("/api/auth/session", { csrfToken, data: proof });
  return status === 200;
}

// A person closing the browser's prompt, or letting it time out, is the ordinary
// way out of one; anything else is the authenticator or the page being wrong.
const cancelled = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");

/**
 * `passed`: the session now carries the second factor. `unavailable`: this account has no passkey to ask for.
 * `signed-out`: the server no longer knows this session (it expired, or the account's security epoch moved), so nothing here can succeed.
 * `not-required`: two-step sign-in has since been turned off, so there is nothing to pass.
 */
export type PasskeyCheck = "passed" | "cancelled" | "refused" | "unavailable" | "signed-out" | "not-required";

// The verify route's 401 means two things: no session behind this cookie, and a
// passkey that did not verify. Only the first has no retry.
const signedOut = (answer: { status: number; body: Record<string, unknown> | null }) =>
  answer.status === 401 && answer.body?.error === "unauthenticated";

/** Asks for a passkey and, when it signs, tells the session. Never throws. */
export async function checkWithPasskey(): Promise<PasskeyCheck> {
  try {
    const asked = await post("/api/mfa/verify", { kind: "passkey", step: "options" });
    if (signedOut(asked)) return "signed-out";
    if (asked.status === 409) return asked.body?.error === "mfa-not-enabled" ? "not-required" : "unavailable";
    if (asked.status !== 200 || asked.body === null) return "refused";
    let response;
    try {
      response = await startAuthentication({ optionsJSON: asked.body.options as never });
    } catch (error) {
      return cancelled(error) ? "cancelled" : "refused";
    }
    const verified = await post("/api/mfa/verify", { kind: "passkey", step: "verify", ticket: asked.body.ticket, response });
    if (signedOut(verified)) return "signed-out";
    if (verified.status !== 200 || verified.body === null) return "refused";
    return (await applySecondFactorProof(verified.body.proof as SecondFactorProofBody)) ? "passed" : "refused";
  } catch {
    return "refused";
  }
}

export type AddPasskeyResult =
  /**
   * `recoveryCodes` is set only for the first factor, which turned two-step sign-in on.
   * `signedIn` is false when the session could not be told: turning it on had already
   * refused this session's old token, so it ends at the next page.
   */
  | { status: "added"; recoveryCodes: string[] | null; signedIn: boolean }
  | { status: "cancelled" }
  | { status: "fresh-check-required" }
  | { status: "failed"; reason: "already-registered" | "other" };

/** Registers a passkey on this account. Never throws. */
export async function addPasskey(): Promise<AddPasskeyResult> {
  try {
    const asked = await post("/api/account/mfa/passkeys", { step: "options" });
    if (asked.status === 403) return { status: "fresh-check-required" };
    if (asked.status !== 200 || asked.body === null) return { status: "failed", reason: "other" };
    let response;
    try {
      response = await startRegistration({ optionsJSON: asked.body.options as never });
    } catch (error) {
      if (cancelled(error)) return { status: "cancelled" };
      // The authenticator already holds a passkey for this account (`excludeCredentials`).
      if (error instanceof Error && error.name === "InvalidStateError") return { status: "failed", reason: "already-registered" };
      return { status: "failed", reason: "other" };
    }
    const added = await post("/api/account/mfa/passkeys", { step: "verify", ticket: asked.body.ticket, response });
    if (added.status === 409) return { status: "failed", reason: "already-registered" };
    if (added.status !== 200 || added.body === null) return { status: "failed", reason: "other" };
    // Turning two-step sign-in on makes this very session half signed in, until it
    // is told. One more try: a lapse in the network here costs the session.
    const proof = added.body.proof as SecondFactorProofBody;
    const signedIn = (await applySecondFactorProof(proof).catch(() => false)) || (await applySecondFactorProof(proof).catch(() => false));
    return { status: "added", recoveryCodes: (added.body.recoveryCodes as string[] | null) ?? null, signedIn };
  } catch {
    return { status: "failed", reason: "other" };
  }
}

/** `locked`: five wrong codes in fifteen minutes (M62 D13); a passkey still works. */
export type CodeCheck = "passed" | "refused" | "locked";

/** Checks a typed authenticator or recovery code and, when it is right, tells the session. Never throws. */
export async function checkWithCode(kind: "otp" | "recovery", code: string): Promise<CodeCheck> {
  try {
    const verified = await post("/api/mfa/verify", { kind, code });
    if (verified.status === 429) return "locked";
    if (verified.status !== 200 || verified.body === null) return "refused";
    return (await applySecondFactorProof(verified.body.proof as SecondFactorProofBody)) ? "passed" : "refused";
  } catch {
    return "refused";
  }
}

export interface AuthenticatorStart {
  ticket: string;
  /** Base32, for "Can't scan?". */
  secret: string;
  /** A data URL of the QR code. */
  qr: string;
}

/** `fresh-check-required` is the route's 403, as for a passkey. */
export type StartAuthenticatorResult =
  | { status: "started"; start: AuthenticatorStart }
  | { status: "fresh-check-required" }
  | { status: "failed" };

/** Asks for a new secret to scan. Never throws. */
export async function startAuthenticator(): Promise<StartAuthenticatorResult> {
  try {
    const started = await post("/api/account/mfa/totp", { step: "start" });
    if (started.status === 403) return { status: "fresh-check-required" };
    if (started.status !== 200 || started.body === null) return { status: "failed" };
    return { status: "started", start: started.body as unknown as AuthenticatorStart };
  } catch {
    return { status: "failed" };
  }
}

export type ConfirmAuthenticatorResult =
  /** `recoveryCodes` is set only for the first factor, which turned two-step sign-in on. */
  | { status: "added"; recoveryCodes: string[] | null }
  | { status: "wrong-code" }
  | { status: "locked" }
  | { status: "failed" };

/** Sends the six digits the app shows; on success tells the session, as a passkey does. Never throws. */
export async function confirmAuthenticator(ticket: string, code: string): Promise<ConfirmAuthenticatorResult> {
  try {
    const added = await post("/api/account/mfa/totp", { step: "confirm", ticket, code });
    if (added.status === 400) return { status: "wrong-code" };
    if (added.status === 429) return { status: "locked" };
    if (added.status !== 200 || added.body === null) return { status: "failed" };
    await applySecondFactorProof(added.body.proof as SecondFactorProofBody);
    return { status: "added", recoveryCodes: (added.body.recoveryCodes as string[] | null) ?? null };
  } catch {
    return { status: "failed" };
  }
}

export type RegenerateResult =
  | { status: "regenerated"; recoveryCodes: string[] }
  | { status: "fresh-check-required" }
  | { status: "failed" };

/** Ten new recovery codes; the old set stops working. Never throws. */
export async function regenerateRecoveryCodes(): Promise<RegenerateResult> {
  try {
    const res = await post("/api/account/mfa/recovery-codes", {});
    if (res.status === 403) return { status: "fresh-check-required" };
    if (res.status !== 200 || res.body === null) return { status: "failed" };
    // Regenerating bumps the epoch; without the proof this very session would be signed out.
    await applySecondFactorProof(res.body.proof as SecondFactorProofBody);
    return { status: "regenerated", recoveryCodes: res.body.recoveryCodes as string[] };
  } catch {
    return { status: "failed" };
  }
}
