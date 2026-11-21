import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import type { SessionWithMfa } from "@/lib/authConfig";
import { authIncludingPending } from "@/server/auth";
import { attemptCode } from "@/server/mfa/attempts";
import { passkeysOf, recordPasskeyUse } from "@/server/mfa/factors";
import { authenticationOptions, verifyAuthentication } from "@/server/mfa/passkey";
import { consumeRecoveryCode } from "@/server/mfa/recoveryCodes";
import { mfaStateFor, mintSecondFactorProof } from "@/server/mfa/state";
import { verifyTotp } from "@/server/mfa/totp";
import { sealingAvailable } from "@/server/secrets/sealed";

// The second step of sign-in (M62 D3a), and the fresh check inside the app. This
// is one of the two places that reads a session that has not passed its second
// factor yet (`authIncludingPending`); the other is Auth.js's own sign-out.
//
// It does not set the claim itself. It verifies the passkey and answers with a
// server-minted proof, which the browser hands to NextAuth's `update`, because
// only the `jwt` callback can write the cookie (`server/mfa/state.ts`).
const Step = z.union([
  z.object({ kind: z.literal("passkey"), step: z.literal("options") }),
  z.object({
    kind: z.literal("passkey"),
    step: z.literal("verify"),
    ticket: z.string().min(1),
    response: z.record(z.string(), z.unknown()),
  }),
  // A code is typed, so it is bounded here and judged in `totp.ts` and `recoveryCodes.ts`.
  z.object({ kind: z.enum(["otp", "recovery"]), code: z.string().min(1).max(64) }),
]);

/**
 * Checks a passkey, an authenticator code or a recovery code for the current session,
 * pending or not, and returns a proof for NextAuth's `update` to write into the cookie.
 */
export async function POST(request: Request) {
  const session = await authIncludingPending();
  const userId = session?.user?.id;
  // The proof is minted for this cookie's `sid` (`server/mfa/state.ts`); a token
  // from before sids existed cannot be upgraded, so it signs in again.
  const sid = (session as SessionWithMfa | null)?.sid;
  if (userId === undefined || userId === "" || !sid) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = Step.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-request" }, { status: 400 });

  const state = await mfaStateFor(userId);
  if (!state.enabled) return Response.json({ error: "mfa-not-enabled" }, { status: 409 });

  const now = new Date();
  if (body.data.kind !== "passkey") {
    const { kind, code } = body.data;
    // Authenticator secrets are sealed under a key; without it a code cannot be judged, and
    // that is the deployment's fault, so it is refused before an attempt is written.
    if (kind === "otp" && !sealingAvailable()) return Response.json({ error: "not-configured" }, { status: 503 });
    // The only way a code is tested (`attempts.ts`): five wrong ones in fifteen
    // minutes lock codes for the account, and a passkey still gets through.
    const attempt = await attemptCode(userId, now, async () =>
      kind === "otp" ? (await verifyTotp(userId, code, now)) !== null : consumeRecoveryCode(userId, code, now),
    );
    if (attempt === "locked") return Response.json({ error: "locked" }, { status: 429 });
    if (attempt === "wrong") return Response.json({ error: "code-not-verified" }, { status: 401 });
    return Response.json({ proof: mintSecondFactorProof(userId, sid, kind, state.epoch, now) });
  }

  const passkeys = await passkeysOf(userId);
  if (body.data.step === "options") {
    if (passkeys.length === 0) return Response.json({ error: "no-passkey" }, { status: 409 });
    return Response.json(await authenticationOptions(userId, sid, passkeys, now));
  }

  const verified = await verifyAuthentication(
    userId,
    sid,
    passkeys,
    body.data.response as unknown as AuthenticationResponseJSON,
    body.data.ticket,
    now,
  );
  // Not a 400: this is somebody who may not be who they say, and the answer is
  // the same whether the key was wrong, the account's, or the challenge stale.
  if (verified === null) return Response.json({ error: "passkey-not-verified" }, { status: 401 });

  // Also the replay check: false for a challenge already spent or a count that
  // went down, and the proof is then not minted.
  if (!(await recordPasskeyUse(verified.factorId, verified.counter, verified.issuedAt, now))) {
    return Response.json({ error: "passkey-not-verified" }, { status: 401 });
  }
  return Response.json({ proof: mintSecondFactorProof(userId, sid, "webauthn", state.epoch, now) });
}
