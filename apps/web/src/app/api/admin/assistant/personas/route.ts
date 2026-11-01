import { z } from "zod";
import type { DebugEdge, DebugPersona, PersonaGraphResponse, PersonaReach } from "@/lib/askDebug";
import { tripAccessFor } from "@/server/access/trip-access";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { grantForPersona, toolsFor, type SurfaceKind } from "@/server/assistant/grants";
import { EDGES, ENTRY, PERSONAS, reachable, type PersonaId, type TurnCaps } from "@/server/assistant/personas";

// The persona graph for one page, under the caller's caps (M57 part 5,
// ADR-085): which persona the page enters, what leaves it, who is reachable
// and what each persona holds. The Ask panel's Debug strip draws it.
//
// Operators only, and 404 to everyone else (`requireAdminApi`, decision D7).
// Nothing here is content: it is `personas.ts` and the tool registry, read
// through the same `grantForPersona` and `toolsFor` a turn uses, so the strip
// cannot say a persona holds a tool the turn would not offer it.
//
//   * 400 `invalid-surface` — `surface` is not one of the nine page kinds.
//
// **The caps are the caller's own on the trip named by `tripId`**: `propose`
// for an editor or owner, `read` otherwise (a viewer, or a trip they cannot
// read). The plan cap is `propose`; resolving the plan's entitlements is a
// per-account read the strip does not need to answer "what can this page do".
const SURFACES = Object.keys(ENTRY) as [SurfaceKind, ...SurfaceKind[]];
const Query = z.object({ surface: z.enum(SURFACES), tripId: z.string().guid().optional() });

/** The graph, with its tool sets, for the page kind named by `surface`. */
export async function GET(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const url = new URL(request.url);
  const query = Query.safeParse({
    surface: url.searchParams.get("surface"),
    tripId: url.searchParams.get("tripId") ?? undefined,
  });
  if (!query.success) return Response.json({ error: "invalid-surface" }, { status: 400 });
  const { surface, tripId } = query.data;

  const access = tripId === undefined ? null : await tripAccessFor(guard.userId, tripId, "editor");
  const role = access?.ok ? "propose" : "read";
  const plan = "propose";
  const caps: TurnCaps = { role, plan, classifier: "propose" };
  const entry = ENTRY[surface];

  const viaSwitch = new Set(reachable(entry, caps, false));
  const viaAny = new Set(reachable(entry, caps, true));
  const reachOf = (id: PersonaId): PersonaReach => (id === entry ? "entry" : viaSwitch.has(id) ? "switch" : viaAny.has(id) ? "hand-off" : "never");
  const posture = role === "propose" ? "propose" : "read-only";

  const personas: DebugPersona[] = (Object.keys(PERSONAS) as PersonaId[]).map((id) => ({
    id,
    label: PERSONAS[id].label,
    does: PERSONAS[id].does,
    reach: reachOf(id),
    tools: toolsFor(grantForPersona(id, { role, plan, classifier: "propose" }), undefined, posture).map((tool) => ({
      name: tool.name,
      domain: tool.domain,
      effect: tool.effect,
    })),
  }));
  // The entry persona first, then by how far each is: the strip is read top-down.
  const rank: Record<PersonaReach, number> = { entry: 0, switch: 1, "hand-off": 2, never: 3 };
  personas.sort((a, b) => rank[a.reach] - rank[b.reach]);

  const edges: DebugEdge[] = EDGES.filter((edge) => edge.from === entry).map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    via: edge.via,
    guard: Object.entries(edge.guard).map(([cap, value]) => `${cap}=${value}`),
  }));

  const body: PersonaGraphResponse = { surface, entry, caps: { role, plan }, personas, edges };
  return Response.json(body);
}
