import { z } from "zod";
import { auth } from "@/server/auth";
import { renameFactor } from "@/server/mfa/factors";

const Rename = z.object({ name: z.string().trim().min(1).max(60) });

// Renaming is not behind the fresh check: it changes a label, never what can sign
// in, and a passkey named after its transport ("Device passkey") is only useful
// once the person has told two of them apart. Remove belongs to part 4.
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
