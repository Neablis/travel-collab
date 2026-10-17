import { AdminTestModeInput } from "@tc/contracts";
import { setTestMode, testModeFor } from "@/server/billing/testMode";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";

// **One account's Stripe test-mode switch** (ADR-076 §6), and its only door.
// The switch lets a test card confer a plan, so both handlers run the admin
// gate before reading anything: to anyone else this is a missing route.
//
//   * 400 `invalid-test-mode` — not an `AdminTestModeInput`.
//   * 404 `not-found` — not an operator (`requireAdminApi`);
//     404 `no-such-account` — the operator named nobody.
//   * 409 `test-mode-unavailable` — turning it on where no test pair is
//     configured, where it would change nothing. Turning it off always works.

type Params = { params: Promise<{ accountId: string }> };

/** The account's switch and whether this deployment could honour it. */
export async function GET(_request: Request, { params }: Params) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const { accountId } = await params;
  const testMode = await testModeFor(accountId);
  if (testMode === null) return Response.json({ error: "no-such-account" }, { status: 404 });
  return Response.json(testMode);
}

/** Turns the account's switch on or off and answers with what is now stored. */
export async function PUT(request: Request, { params }: Params) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = AdminTestModeInput.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-test-mode", issues: body.error.issues }, { status: 400 });
  }
  const { accountId } = await params;
  const before = await testModeFor(accountId);
  if (before === null) return Response.json({ error: "no-such-account" }, { status: 404 });
  if (body.data.enabled && !before.available) {
    return Response.json({ error: "test-mode-unavailable" }, { status: 409 });
  }
  if (!(await setTestMode(accountId, body.data.enabled))) {
    return Response.json({ error: "no-such-account" }, { status: 404 });
  }
  return Response.json({ ...before, enabled: body.data.enabled });
}
