import { createHash } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import { publicOrigin } from "@/lib/deployment/env";
import { digestsMatch, keyedDigest } from "@/server/secrets/keyedDigest";

// WebAuthn for the second step (ADR-092, M62 D10). No database in this file: the
// routes read and write `user_factors` (`factors.ts`) and hand rows in, so what is
// tested here is the ceremony.

const RP_NAME = "Caesura";

/**
 * The deployment's own host, so a passkey made on production never unlocks a
 * preview (ADR-092). Read per call, from configuration and never from the
 * request, which a client could shape.
 */
export function rpId(): string {
  return new URL(publicOrigin()).hostname;
}

// **Challenges are not stored.** There is no table for them and no later part adds
// a migration, so each one is sealed: the options come back with a ticket, a keyed
// digest over this account, the session that asked, this ceremony, the challenge
// and its expiry. The browser returns it with the signed response, and a challenge
// the server did not issue, for another account, for another session's cookie or
// past five minutes, has no valid ticket.
//
// **Single use comes from the ticket's age.** Its expiry less the lifetime is when
// it was issued, and `recordPasskeyUse` accepts an assertion only when that is
// later than the passkey's last use, so a captured pair is spent by its first
// use, which moves the mark past it. This covers synced platform passkeys (Apple,
// Google), which sign with a counter of 0 forever and so never trip the library's
// sign-count check. The price is that a ticket asked for before another one was
// used is spent too: two tabs asking at once, and the slower one asks again.
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

type Ceremony = "register" | "authenticate";

function sealOf(userId: string, sid: string, ceremony: Ceremony, challenge: string, expiresAt: number): string {
  return keyedDigest(`webauthn-challenge|${userId}|${sid}|${ceremony}|${challenge}|${expiresAt}`).digest;
}

function ticketFor(userId: string, sid: string, ceremony: Ceremony, challenge: string, now: Date): string {
  const expiresAt = now.getTime() + CHALLENGE_LIFETIME_MS;
  return `${expiresAt}.${sealOf(userId, sid, ceremony, challenge, expiresAt)}`;
}

/** The challenge the browser signed and when it was issued, if the ticket says this server issued it to this account and session and it has not expired. */
function challengeFromTicket(
  userId: string,
  sid: string,
  ceremony: Ceremony,
  signedChallenge: string,
  ticket: string,
  now: Date,
): { challenge: string; issuedAt: number } | null {
  const [expiry, seal] = ticket.split(".");
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || seal === undefined || expiresAt < now.getTime()) return null;
  return digestsMatch(seal, sealOf(userId, sid, ceremony, signedChallenge, expiresAt))
    ? { challenge: signedChallenge, issuedAt: expiresAt - CHALLENGE_LIFETIME_MS }
    : null;
}

function signedChallengeOf(response: { response: { clientDataJSON: string } }): string | null {
  try {
    return decodeClientDataJSON(response.response.clientDataJSON).challenge;
  } catch {
    return null;
  }
}

/** The columns of a `user_factors` passkey row that a ceremony needs. */
export interface StoredPasskey {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}

export async function registrationOptions(
  user: { id: string; label: string },
  sid: string,
  existing: readonly StoredPasskey[],
  now: Date,
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; ticket: string }> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    // The account's own id would be readable by any site that sees the handle:
    // a digest gives the authenticator a stable handle that names nobody.
    userID: createHash("sha256").update(`caesura-passkey-user|${user.id}`).digest(),
    userName: user.label,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports ?? undefined })),
    // Biometric unlock is the point (M62 D3a): the authenticator must verify the person.
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  return { options, ticket: ticketFor(user.id, sid, "register", options.challenge, now) };
}

export interface VerifiedRegistration {
  credentialId: string;
  /** The COSE public key, base64url, as stored. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** A starting name, from what the authenticator said it is. The person can rename it. */
  name: string;
}

// Authenticators do not report a model name, only how they are reached
// (`transports`), so the default name says that. It is the best the protocol
// offers and the person renames it in one click.
function nameFrom(transports: readonly string[]): string {
  if (transports.includes("internal")) return "Device passkey";
  if (transports.includes("hybrid")) return "Phone passkey";
  if (transports.some((t) => t === "usb" || t === "nfc" || t === "ble")) return "Security key";
  return "Passkey";
}

/** The new credential, or null for anything the ceremony refuses: a wrong challenge, origin or RP ID, an expired or foreign ticket, a malformed response. */
export async function verifyRegistration(
  userId: string,
  sid: string,
  response: RegistrationResponseJSON,
  ticket: string,
  now: Date,
): Promise<VerifiedRegistration | null> {
  const signed = signedChallengeOf(response);
  if (signed === null) return null;
  const expected = challengeFromTicket(userId, sid, "register", signed, ticket, now);
  if (expected === null) return null;
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected.challenge,
      expectedOrigin: publicOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    const { credential } = result.registrationInfo;
    const transports = response.response.transports ?? [];
    return {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports,
      name: nameFrom(transports),
    };
  } catch {
    return null;
  }
}

export async function authenticationOptions(
  userId: string,
  sid: string,
  passkeys: readonly StoredPasskey[],
  now: Date,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; ticket: string }> {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: p.transports ?? undefined })),
    userVerification: "required",
  });
  return { options, ticket: ticketFor(userId, sid, "authenticate", options.challenge, now) };
}

/**
 * The passkey that signed, with the counter to store, or null when the response
 * is not a valid assertion by one of THIS account's passkeys: forged, signed by
 * another key, for another account's credential, a stale challenge or another
 * session's, or a counter that went backwards (a cloned authenticator). `issuedAt`
 * is for `recordPasskeyUse`, which is what makes the challenge single use.
 */
export async function verifyAuthentication(
  userId: string,
  sid: string,
  passkeys: readonly StoredPasskey[],
  response: AuthenticationResponseJSON,
  ticket: string,
  now: Date,
): Promise<{ factorId: string; counter: number; issuedAt: number } | null> {
  const passkey = passkeys.find((p) => p.credentialId === response.id);
  if (passkey === undefined) return null;
  const signed = signedChallengeOf(response);
  if (signed === null) return null;
  const expected = challengeFromTicket(userId, sid, "authenticate", signed, ticket, now);
  if (expected === null) return null;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected.challenge,
      expectedOrigin: publicOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
    });
    if (!result.verified) return null;
    return { factorId: passkey.id, counter: result.authenticationInfo.newCounter, issuedAt: expected.issuedAt };
  } catch {
    return null;
  }
}
