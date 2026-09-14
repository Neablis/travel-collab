import { auth } from "@/server/auth";
import { accountPlanView } from "@/server/entitlements/accountPlan";

// What the account sheet's Plan section reads (M20 link 5's display half).
//
// **Its own identity, never a query parameter.** An account may see its own
// plan and nobody else's, and the only way to guarantee that is for the caller
// not to name a subject. Reading another account's standing is the operator
// console's job and goes through `requireAdminApi`.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return Response.json({ plan: await accountPlanView(userId) });
}
