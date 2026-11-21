import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import type { SessionWithMfa } from "@/lib/authConfig";
import { auth } from "@/server/auth";
import { isUniqueViolation } from "@/server/eventStore";
import { addPasskey, passkeysOf } from "@/server/mfa/factors";
import { registrationOptions, verifyRegistration } from "@/server/mfa/passkey";
import { hasFreshCheck, mfaStateFor, mintSecondFactorProof } from "@/server/mfa/state";

// Adding a passkey (M62 D6, D10): two steps, as WebAuthn is. `options` hands the
// browser what to ask its authenticator; `verify` takes what came back. The first
// factor on an account turns two-step sign-in on and returns the ten recovery
// codes, which are shown once and never readable again.
const Step = z.discriminatedUnion("step", [
  z.object({ step: z.literal("options") }),
  z.object({ step: z.literal("verify"), ticket: z.string().min(1), response: z.record(z.string(), z.unknown()) }),
]);

/**
 * One step of adding a passkey: `options` returns the creation options and a ticket,
 * `verify` stores the credential and returns this session's proof, plus the recovery codes
 * when it is the account's first factor. 403 without a fresh check.
 */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as SessionWithMfa | null)?.sid;
  if (userId === undefined || userId === "" || !sid) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = Step.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-request" }, { status: 400 });

  const now = new Date();
  const state = await mfaStateFor(userId);
  // Adding a way in is the act an attacker holding only a stolen session would
  // try first, so it asks again: a second factor within ten minutes, or a fresh
  // Google sign-in while there is none to ask for. 403 and a name, so the screen
  // can open its check rather than show an error.
  if (!hasFreshCheck(state.enabled, session as SessionWithMfa, now)) {
    return Response.json({ error: "fresh-check-required" }, { status: 403 });
  }

  const existing = await passkeysOf(userId);
  if (body.data.step === "options") {
    const label = session?.user?.email ?? userId;
    return Response.json(await registrationOptions({ id: userId, label }, sid, existing, now));
  }

  const added = await verifyRegistration(
    userId,
    sid,
    body.data.response as unknown as RegistrationResponseJSON,
    body.data.ticket,
    now,
  );
  if (added === null) return Response.json({ error: "passkey-not-verified" }, { status: 400 });

  let recoveryCodes: string[] | null;
  try {
    ({ recoveryCodes } = await addPasskey(userId, added, now));
  } catch (error) {
    // Only the unique index on the credential id says "already registered"; the
    // transaction has rolled back whatever else failed, and that is a 500.
    if (!isUniqueViolation(error)) throw error;
    return Response.json({ error: "passkey-already-registered" }, { status: 409 });
  }
  // Registering the first factor proves the person holds it, so this session earns
  // the second step it would otherwise be turned away for the moment MFA is on. A
  // later one gets an `epoch` proof: it restarts no fresh-check clock, or enrolling
  // would extend the check it was let in on.
  const { epoch } = await mfaStateFor(userId);
  const method = recoveryCodes === null ? "epoch" : "webauthn";
  return Response.json({ recoveryCodes, proof: mintSecondFactorProof(userId, sid, method, epoch, now) });
}
