import { z } from "zod";
import type { SessionWithMfa } from "@/lib/authConfig";
import { auth } from "@/server/auth";
import { attemptCode } from "@/server/mfa/attempts";
import { addTotp } from "@/server/mfa/factors";
import { hasFreshCheck, mfaStateFor, mintSecondFactorProof } from "@/server/mfa/state";
import { confirmTotp, startTotp, type ConfirmedTotp } from "@/server/mfa/totp";
import { isUniqueViolation } from "@/server/eventStore";
import { MfaSecretKeyMissingError, sealingAvailable } from "@/server/secrets/sealed";

// Adding an authenticator app (M62 D2, D6): `start` hands back a secret to scan and
// `confirm` takes the code the app shows. Nothing is stored until it does. As with
// a passkey, the first factor on an account turns two-step sign-in on and returns
// the ten recovery codes once.
const Step = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start") }),
  z.object({ step: z.literal("confirm"), ticket: z.string().min(1), code: z.string().min(1).max(32) }),
]);

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as SessionWithMfa | null)?.sid;
  if (userId === undefined || userId === "" || !sid) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = Step.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-request" }, { status: 400 });

  const now = new Date();
  const state = await mfaStateFor(userId);
  // The same fresh check as a passkey: adding a way in is what a stolen session tries first.
  if (!hasFreshCheck(state.enabled, session as SessionWithMfa, now)) {
    return Response.json({ error: "fresh-check-required" }, { status: 403 });
  }

  if (body.data.step === "start") {
    try {
      return Response.json(await startTotp(userId, session?.user?.email ?? userId, now));
    } catch (error) {
      // Without `MFA_SECRET_KEY` there is nowhere safe to keep the secret, so enrolment is refused.
      if (error instanceof MfaSecretKeyMissingError) return Response.json({ error: "not-configured" }, { status: 503 });
      throw error;
    }
  }

  const { ticket, code } = body.data;
  // Before any attempt is written: with no key the code cannot be judged, so it must not count.
  if (!sealingAvailable()) return Response.json({ error: "not-configured" }, { status: 503 });
  let confirmed: ConfirmedTotp | null = null;
  // Even here: a code typed at enrolment is a guess at a secret nobody has proved
  // they hold, so it is counted like any other (`attempts.ts`).
  const attempt = await attemptCode(userId, now, async () => {
    confirmed = confirmTotp(userId, ticket, code, now);
    return confirmed !== null;
  });
  if (attempt === "locked") return Response.json({ error: "locked" }, { status: 429 });
  if (attempt === "wrong" || confirmed === null) return Response.json({ error: "code-wrong" }, { status: 400 });

  let recoveryCodes: string[] | null;
  try {
    ({ recoveryCodes } = await addTotp(userId, confirmed, now));
  } catch (error) {
    // The primary key alone: this ticket was already confirmed. Anything else is a fault.
    if (!isUniqueViolation(error)) throw error;
    return Response.json({ error: "already-added" }, { status: 409 });
  }
  const { epoch } = await mfaStateFor(userId);
  return Response.json({ recoveryCodes, proof: mintSecondFactorProof(userId, sid, "otp", epoch, now) });
}
