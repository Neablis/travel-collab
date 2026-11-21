import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { mfaResets, users } from "@/server/db/schema";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { emailSecurityChange, turnOffIn } from "@/server/mfa/changes";
import { bumpSecurityEpoch, lockAccount } from "@/server/mfa/state";

// **Reset two-step sign-in** (M62 D9, D15): the one way back for an account that
// lost every factor and every recovery code. The operator gives a reason and
// ticks that the account's own email asked for it; both are kept in an
// `mfa_resets` row with who did it.
//
//   * 400 `invalid-mfa-reset` — no reason, or the tick not given.
//   * 404 `not-found` — not an operator (`requireAdminApi`);
//     404 `no-such-account` — the operator named nobody.
//   * 409 `mfa-not-enabled` — nothing to reset;
//     409 `no-email-on-account` — no address the tick could be about.

// The console's own request, not a contract: no other consumer sends it (as
// `lib/mfaWire.ts` says of the account's MFA routes).
const ResetInput = z.object({
  reason: z.string().trim().min(1),
  confirmed: z.literal(true),
});

type Params = { params: Promise<{ accountId: string }> };

/** Clears every factor and code, turns two-step off, signs out every session and emails the account. */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = ResetInput.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-mfa-reset", issues: body.error.issues }, { status: 400 });
  }
  const { accountId } = await params;
  const [account] = await db
    .select({ email: users.email, enabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, accountId));
  if (account === undefined) return Response.json({ error: "no-such-account" }, { status: 404 });
  if (account.enabledAt === null) return Response.json({ error: "mfa-not-enabled" }, { status: 409 });
  if (!account.email) return Response.json({ error: "no-email-on-account" }, { status: 409 });
  const email = account.email;

  // The account's own Turn off and its epoch bump, with the record in the same
  // transaction, so a reset is never done without saying who did it. The read
  // above can be stale by now: a second reset, or the account's own Turn off, may
  // have landed since. So the row is taken and read again first, and a reset that
  // finds nothing left to reset records nothing and sends nothing.
  const now = new Date();
  const done = await db.transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const [current] = await tx.select({ enabledAt: users.mfaEnabledAt }).from(users).where(eq(users.id, accountId));
    if (!current?.enabledAt) return false;
    await turnOffIn(tx, accountId);
    await tx.insert(mfaResets).values({
      id: randomUUID(),
      userId: accountId,
      operatorId: guard.userId,
      reason: body.data.reason,
      emailConfirmation: email,
      at: now,
    });
    await bumpSecurityEpoch(accountId, tx);
    return true;
  });
  if (!done) return Response.json({ error: "mfa-not-enabled" }, { status: 409 });
  await emailSecurityChange({ userId: accountId, change: "operator-reset", request: null, now });
  return Response.json({ at: now.toISOString() });
}
