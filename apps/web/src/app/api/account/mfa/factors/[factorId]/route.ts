import { z } from "zod";
import { auth } from "@/server/auth";
import type { SessionWithMfa } from "@/lib/authConfig";
import { ChangeRefused, recordSecurityChange, removeFactorIn } from "@/server/mfa/changes";
import { renameFactor } from "@/server/mfa/factors";
import { hasFreshCheck, mfaStateFor } from "@/server/mfa/state";

const Rename = z.object({ name: z.string().trim().min(1).max(60) });

// Renaming is not behind the fresh check: it changes a label, never what can sign
// in, and a passkey named after its transport ("Device passkey") is only useful
// once the person has told two of them apart. Remove is below.
/** Renames one of the signed-in account's factors; 404 for an id that is malformed or not theirs. */
export async function PATCH(request: Request, { params }: { params: Promise<{ factorId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined || userId === "") return Response.json({ error: "unauthenticated" }, { status: 401 });

  const body = Rename.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-name" }, { status: 400 });

  const { factorId } = await params;
  // A malformed id and someone else's id both read as not found, so the answer
  // never says which factor ids exist.
  if (!z.uuid().safeParse(factorId).success || !(await renameFactor(userId, factorId, body.data.name))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json({ id: factorId, name: body.data.name });
}

// *Remove* (M62 D7): behind the fresh check, refused for the last factor, and an
// epoch bump that signs out every other session. The malformed and the foreign id
// read as not found, as for rename.
/** Removes one of the signed-in account's factors and returns this session's proof. 409 for the last factor, 404 for an id that is malformed or not theirs. */
export async function DELETE(request: Request, { params }: { params: Promise<{ factorId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as SessionWithMfa | null)?.sid;
  if (userId === undefined || userId === "" || !sid) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const now = new Date();
  const { enabled } = await mfaStateFor(userId);
  if (!hasFreshCheck(enabled, session as SessionWithMfa, now)) {
    return Response.json({ error: "fresh-check-required" }, { status: 403 });
  }
  const { factorId } = await params;
  if (!z.uuid().safeParse(factorId).success) return Response.json({ error: "not-found" }, { status: 404 });

  try {
    const { proof } = await recordSecurityChange({
      userId,
      sid,
      change: "factor-removed",
      request,
      now,
      apply: (tx) => removeFactorIn(tx, userId, factorId),
    });
    return Response.json({ proof });
  } catch (error) {
    if (!(error instanceof ChangeRefused)) throw error;
    return error.reason === "last-factor"
      ? Response.json({ error: "last-factor" }, { status: 409 })
      : Response.json({ error: "not-found" }, { status: 404 });
  }
}
