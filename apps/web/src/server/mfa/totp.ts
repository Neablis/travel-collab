import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { db } from "@/server/db/client";
import { userFactors } from "@/server/db/schema";
import { MfaSecretKeyMissingError, seal, unseal } from "@/server/secrets/sealed";

// Authenticator apps (M62 D2): RFC 6238, six digits, 30 seconds, SHA-1 because that
// is what every app speaks. A code is accepted one step either side of now, to
// forgive a slow clock, and works once: `last_used_step` only ever moves forward.
const PERIOD_S = 30;
const WINDOW = 1;
const ENROLMENT_MS = 10 * 60 * 1000;
export const AUTHENTICATOR_NAME = "Authenticator app";

const totpFor = (secret: OTPAuth.Secret, label = "account") =>
  new OTPAuth.TOTP({ issuer: "Caesura", label, algorithm: "SHA1", digits: 6, period: PERIOD_S, secret });

/** What a person types: the six digits, with the spaces some apps print between them. */
const digitsOf = (code: string) => code.replace(/\s/g, "");

/** The time step `code` is valid for at `now` (within the window), or null. */
function stepOf(secret: OTPAuth.Secret, code: string, now: Date): number | null {
  const token = digitsOf(code);
  if (!/^\d{6}$/.test(token)) return null;
  const delta = totpFor(secret).validate({ token, timestamp: now.getTime(), window: WINDOW });
  return delta === null ? null : Math.floor(now.getTime() / 1000 / PERIOD_S) + delta;
}

export interface TotpEnrolment {
  /** Handed back to `confirmTotp`; it carries the sealed secret, so nothing is stored until a code proves the app has it. */
  ticket: string;
  /** Base32, for "Can't scan?". Shown to the person who asked for it, never stored in the clear. */
  secret: string;
  /** An `<img src>` for the QR code of the `otpauth://` link. */
  qr: string;
}

/**
 * A new secret for the person to put in their app. Nothing is written: the ticket
 * is the secret sealed with the id the factor row will have, tied to this account
 * and to ten minutes, so abandoned enrolments leave no rows to sweep. Throws when
 * `MFA_SECRET_KEY` is unset, which is enrolment failing closed.
 */
export async function startTotp(userId: string, label: string, now: Date): Promise<TotpEnrolment> {
  const secret = new OTPAuth.Secret({ size: 20 });
  const factorId = randomUUID();
  const ticket = `${factorId}.${seal(`${userId}|${now.getTime() + ENROLMENT_MS}|${secret.base32}`, factorId)}`;
  const uri = totpFor(secret, label).toString();
  return { ticket, secret: secret.base32, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
}

export interface ConfirmedTotp {
  factorId: string;
  /** The sealed secret, already bound to `factorId`. */
  sealedSecret: string;
  step: number;
}

/**
 * The secret in `ticket` when it is this account's, unexpired and `code` is the
 * current code for it. The caller runs this inside `attemptCode`: this function
 * only judges the code and never counts anything.
 */
export function confirmTotp(userId: string, ticket: string, code: string, now: Date): ConfirmedTotp | null {
  const dot = ticket.indexOf(".");
  if (dot < 1) return null;
  const factorId = ticket.slice(0, dot);
  let opened: string;
  try {
    opened = unseal(ticket.slice(dot + 1), factorId);
  } catch (error) {
    // A missing key is the deployment's fault, not a wrong code (`MfaSecretKeyMissingError`).
    if (error instanceof MfaSecretKeyMissingError) throw error;
    return null;
  }
  const [owner, expires, base32] = opened.split("|");
  if (owner !== userId || Number(expires) < now.getTime() || base32 === undefined) return null;
  const step = stepOf(OTPAuth.Secret.fromBase32(base32), code, now);
  if (step === null) return null;
  return { factorId, sealedSecret: seal(base32, factorId), step };
}

/**
 * The factor whose current code `code` is, with its step spent; null otherwise.
 * The spend is one conditional UPDATE, so two requests carrying the same code
 * cannot both win. Run it inside `attemptCode`.
 */
export async function verifyTotp(userId: string, code: string, now: Date): Promise<string | null> {
  const rows = await db
    .select({ id: userFactors.id, sealed: userFactors.sealedSecret })
    .from(userFactors)
    .where(and(eq(userFactors.userId, userId), eq(userFactors.kind, "totp")));
  for (const row of rows) {
    if (row.sealed === null) continue;
    let secret: OTPAuth.Secret;
    try {
      secret = OTPAuth.Secret.fromBase32(unseal(row.sealed, row.id));
    } catch (error) {
      // A missing key is the deployment's fault, not a wrong code: it must not read as one.
      if (error instanceof MfaSecretKeyMissingError) throw error;
      // A row that will not open (the key was rotated away) is one that cannot match.
      continue;
    }
    const step = stepOf(secret, code, now);
    if (step === null) continue;
    const spent = await db
      .update(userFactors)
      .set({ lastUsedStep: step, lastUsedAt: now })
      .where(and(eq(userFactors.id, row.id), or(isNull(userFactors.lastUsedStep), lt(userFactors.lastUsedStep, step))))
      .returning({ id: userFactors.id });
    if (spent.length > 0) return row.id;
  }
  return null;
}
