// What a turn is allowed to hold, and where the tool set comes from
// (ADR-043 decision 2).
//
// **The three hand-written name manifests are gone, and this is what replaced
// them.** `offeredToolNamesFor` was a switch over three set names —
// `READ_TOOL_NAMES`, `WRITE_TOOL_NAMES`, `PAGE_TOOL_NAMES` — and its test
// asserted it against itself (F-F02). Every tool already knew its own domain
// and effect; the switch was a second statement of the same fact, and every new
// tool had to be added to both. The set is now a FILTER over the registry, so
// adding a tool that belongs on one surface is one tag and adding a surface is
// one row.
//
// ADR-033 Decision 4's narrowing — *"a page turn holds no `RemoveActivity`, and
// a planning turn holds no `insert_widget`"* — stops being a sentence three
// constants have to keep true. It is the `itinerary` domain capped at `read` on
// the page surface, and the `pages` domain being absent from the planning one.
import type { TripRole } from "@tc/contracts";
import { roleAtLeast } from "@/server/accessPolicy";
import type { AnyAssistantTool, ToolDomain, ToolEffect } from "./defineTool";
import { ASSISTANT_TOOLS } from "./registry";

/**
 * What the user is actually looking at, which is NOT the same axis as a tool
 * set.
 *
 * These are `AskScope`'s three kinds. The old sets were `read-only | planning |
 * page`, and conflating the two axes is the trap: a `trip`-scoped turn taken by
 * a viewer is read-only, and nothing about the surface says so. What the
 * surface contributes is one of the four caps below.
 */
export type SurfaceKind = "trip" | "day" | "page";

/** One domain, and the most a surface will ever grant in it. */
export interface DomainCap {
  domain: ToolDomain;
  max: ToolEffect;
}

/**
 * A grant is a **list of (domain, maxEffect) pairs**, not one effect across all
 * domains, and that asymmetry is load-bearing: the page surface caps
 * `itinerary` at `read` while granting `pages` at `propose`. A single effect
 * could not express a turn that reads the trip in order to write about it.
 */
export type SurfaceGrant = readonly DomainCap[];

/**
 * The whole of "which tools exist on which surface", as data.
 *
 * A missing domain means NOT GRANTED — `places`, `account` and `system` are
 * absent from every row here because no tool declares them yet, and a tool that
 * did would be offered nowhere until a row named its domain. That is the
 * correct default for a capability table: silence denies.
 */
export const SURFACES = {
  trip: [
    { domain: "itinerary", max: "propose" },
    { domain: "library", max: "propose" },
  ],
  day: [
    { domain: "itinerary", max: "propose" },
    { domain: "library", max: "propose" },
  ],
  // A page turn reads the trip and writes the page. `library` stays at `read`
  // rather than being left out, because a page turn browses the corpus today
  // (`search_playbooks`) and only the `library` row keeps it.
  //
  // The spec says tagging `search_playbooks` `itinerary` would silently drop it
  // from this surface. It would not, and the difference matters to whoever
  // edits this table next: `itinerary` and `library` carry the SAME cap on all
  // three rows, so retagging either library tool changes no tool set at all
  // today. The tags are the audit vocabulary and what a fourth surface would
  // grant one of without the other; they are pinned directly in `grants.test.ts`
  // because nothing in this table can pin them.
  page: [
    { domain: "itinerary", max: "read" },
    { domain: "library", max: "read" },
    { domain: "pages", max: "propose" },
  ],
} as const satisfies Record<SurfaceKind, SurfaceGrant>;

/** The resolved grant: the most this turn may do in each domain it holds. */
export type AiGrant = Readonly<Partial<Record<ToolDomain, ToolEffect>>>;

const EFFECT_RANK: Record<ToolEffect, number> = { read: 0, propose: 1 };

function minEffect(a: ToolEffect, b: ToolEffect): ToolEffect {
  return EFFECT_RANK[a] <= EFFECT_RANK[b] ? a : b;
}

/**
 * The four independent caps a turn's grant is the minimum of.
 *
 * They are four because they answer four different questions, and the middle
 * two are the ones a boolean loses:
 *
 *   * `surface`    — what this surface is about at all.
 *   * `role`       — viewer → `read`, editor → `propose` (trip membership).
 *   * `plan`       — what the caller's plan permits. See `permitsPropose`.
 *   * `classifier` — question → `read`, edit/plan → `propose` (askIntent.ts).
 */
export interface EffectCaps {
  surface: SurfaceKind;
  role: ToolEffect;
  plan: ToolEffect;
  classifier: ToolEffect;
}

/**
 * What the caller's PLAN permits — the one term with no source yet.
 *
 * M20 owns it. It is a port rather than a missing term so that the shape is
 * real now and the arithmetic below is the arithmetic that ships: a turn's
 * grant is a minimum over four caps, and a fourth one appearing later must not
 * be a re-derivation of the other three. Today it permits `propose` for
 * everybody, which is exactly today's behaviour — there is no plan to consult,
 * and no tier, ceiling or table is invented here to pretend otherwise.
 *
 * If M20's answer needs IO, it is resolved BEFORE `grantFor` is called, which
 * is what keeps `grantFor` a pure minimum over four values.
 */
export type PlanEffectPort = (actor: { userId: string }) => ToolEffect;

export const permitsPropose: PlanEffectPort = () => "propose";

/**
 * `grantedEffect(domain) = min(surface[domain], role, plan, classifier)`.
 *
 * The three non-surface caps apply to every domain the surface names, because
 * each of them is a fact about the TURN rather than about a domain: a viewer is
 * a viewer everywhere, and a question is a question everywhere. Only the
 * surface knows that a page turn reads the itinerary and writes the page.
 */
export function grantFor(caps: EffectCaps): AiGrant {
  const ceiling = minEffect(caps.role, minEffect(caps.plan, caps.classifier));
  const grant: Partial<Record<ToolDomain, ToolEffect>> = {};
  for (const { domain, max } of SURFACES[caps.surface]) grant[domain] = minEffect(max, ceiling);
  return grant;
}

/**
 * The registry, filtered by the grant — in registry order, which is the order
 * the three sets have always been assembled in.
 *
 * A tool whose domain the grant does not name is not offered at all; a tool
 * whose effect exceeds what its domain was granted is not offered either. Those
 * two sentences are the whole of the narrowing.
 */
export function toolsFor(grant: AiGrant): readonly AnyAssistantTool[] {
  return ASSISTANT_TOOLS.filter((definition) => {
    const granted = grant[definition.domain];
    return granted !== undefined && EFFECT_RANK[definition.effect] <= EFFECT_RANK[granted];
  });
}

/**
 * **The guard follows the tool set, not the endpoint.**
 *
 * The endpoint /ask merged in asked for `editor` unconditionally, because every
 * surface it served wrote. A read-only turn is different: a viewer may ask
 * about a trip they can already see, and refusing them would be a permission
 * rule that exists only because the assistant shares a route with one that
 * writes. Now that there is one route, this computation is the whole
 * difference.
 *
 * Written as a computation rather than a constant so the rule is executable.
 * The moment a tool that needs `editor` is offered — `AddActivity`, or
 * `insert_widget` — this answers `editor` without anyone having to remember.
 * Page authoring writes a page, so it lands on the same answer as a planning
 * write, by the same rule and not by a second one. It is not consulted only at
 * the door: the handler asks it what the set it is ABOUT to hand the agent
 * requires, and refuses to build an agent the actor's role does not cover.
 *
 * **It is now the maximum over the set ACTUALLY SELECTED**, which is what its
 * own comment always said it wanted to be — the hand-written
 * `READ_TOOL_NAMES` membership test was the thing stopping it. A tool arriving
 * with `minimumRole: "owner"` would raise the answer here with no edit, where
 * the old spelling would have called it `editor`.
 */
export function minimumRoleFor(tools: readonly AnyAssistantTool[]): TripRole {
  return tools.reduce<TripRole>(
    (highest, tool) => (roleAtLeast(tool.minimumRole, highest) ? tool.minimumRole : highest),
    "viewer",
  );
}

/**
 * What this turn may do, which is not the same question as what the ACTOR may
 * do. Three answers, and the middle one is the reason this is not a boolean.
 *
 *   * `propose`   — an editor, holding the write tools.
 *   * `withheld`  — an editor whose turn the classifier read as a question, so
 *     the write tools were not handed over (askIntent.ts).
 *   * `read-only` — a viewer. They cannot edit at all.
 */
export type AskToolPosture = "propose" | "withheld" | "read-only";

/**
 * The posture, DERIVED from the same four caps rather than passed in beside
 * them.
 *
 * `withheld` is precisely the case where role and plan both permit `propose`
 * and the classifier did not, and that is why it can be derived at all: the two
 * causes of "no write tools this turn" are structurally distinguishable, so the
 * instruction can stay honest about which one happened. Telling an editor "I
 * can only answer questions" is a lie, and a lie with no recovery path — there
 * is no mid-turn escalation and no client retry (see `ACCESS_LINE`). Deriving
 * it is what stops a fourth input drifting out of step with the three that
 * decide the tools.
 *
 * A plan that does not permit `propose` reads as `read-only` rather than
 * `withheld`: rephrasing would not recover it, so the withheld copy's "ask
 * again saying what you want changed" would be the same dead end it exists to
 * avoid. Unreachable today — `permitsPropose` permits everybody — and M20 is
 * where it stops being.
 */
export function postureFor(caps: Pick<EffectCaps, "role" | "plan" | "classifier">): AskToolPosture {
  if (caps.role !== "propose" || caps.plan !== "propose") return "read-only";
  return caps.classifier === "propose" ? "propose" : "withheld";
}
