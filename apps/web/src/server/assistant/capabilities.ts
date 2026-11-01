// **What each surface can change, and where everything else is done** (M56,
// ADR-084 §4), generated from the surface table and the tool registry.
//
// Home's instruction used to say *"say plainly that changes are made inside a
// trip"*, so asked to plan a trip it refused with nothing to press. Each
// surface's instruction now carries this block instead: the changes its grant
// holds, and for every change it lacks, the `hand_off` target that serves it.
// A grant or a change tool added moves the block with no prose edit; a change
// DOMAIN added fails `capabilityBlock.test.ts` until it is described here.
import { HAND_OFF_TARGETS, type HandOffTo } from "@tc/contracts";
import { EFFECT_LEVEL, type ToolDomain } from "./defineTool";
import { grantForPersona, postureFor, toolsFor, type SurfaceKind } from "./grants";
import { ENTRY, PERSONAS, reachable, switchTargetsOf, type PersonaId } from "./personas";
import { rule, type PromptBlock } from "./prompt";
import type { TaskClass } from "./taskClass";
import { ASSISTANT_TOOLS } from "./registry";
import { SWITCH_PERSONA_TOOL_NAME } from "./tools/switchPersona";
import { GO_TO_TOOL_NAME } from "./tools/navigate";
import { HAND_OFF_TOOL_NAME, ASK_USER_TOOL_NAME, SHOW_OPTIONS_TOOL_NAME } from "./tools/ui";

/**
 * A change in each domain, as the model is told it. Null for a domain whose
 * tools change nothing (a read, a search, a widget). Exhaustive by type, so a
 * new domain has to say which it is.
 */
export const CHANGE_IN: Readonly<Record<ToolDomain, string | null>> = {
  itinerary: "the trip's plan: its days, stops, times, dates and name",
  library: "a published playbook day added to a trip",
  pages: "a notebook page",
  playbook: "a playbook taken into a trip",
  places: null,
  account: null,
  system: null,
  playbookList: null,
  ui: null,
};

/** The domains whose tools change something: any tool at `propose` level, read off the registry. */
export function changeDomains(): ToolDomain[] {
  return [...new Set(ASSISTANT_TOOLS.filter((tool) => EFFECT_LEVEL[tool.effect] === "propose").map((tool) => tool.domain))];
}

/** Where a change this surface lacks is done: a hand-off target, or a notebook opened with `go_to`. */
export type CapabilityRoute = HandOffTo | typeof GO_TO_TOOL_NAME;

/** One surface's changes, the ones it sends elsewhere, and its hand-off targets. */
export interface Capabilities {
  /** What this surface can change, in words. */
  changes: string[];
  /** Each change it cannot make, and where that is done. */
  elsewhere: { change: string; domain: ToolDomain; to: CapabilityRoute[] }[];
  /** What `hand_off` may name from here. */
  targets: HandOffTo[];
}

const ABOUT_A_TRIP: ReadonlySet<SurfaceKind> = new Set(["trip", "day", "page"]);

function routeFor(surface: SurfaceKind, domain: ToolDomain): CapabilityRoute[] {
  // A surface about no trip sends a change to a trip the person names, or to
  // a new one.
  if (!ABOUT_A_TRIP.has(surface)) return ["plan_page", "new_trip"];
  // On a trip, a notebook is one `go_to` away; everything else is the plan.
  return domain === "pages" ? [GO_TO_TOOL_NAME] : ["plan_page"];
}

/**
 * Why a turn changes nothing its surface could: the person's role on this trip
 * (a viewer or suggester), or a plan without assistant changes. Null when
 * neither holds it back. The role wins when both do: upgrading a plan gives
 * nobody edit rights on someone else's trip.
 */
export type ChangeLimit = "role" | "plan" | null;

/**
 * The surface's capabilities, on a turn held back by `limit`. A limited turn
 * makes none of the surface's changes and sends none elsewhere, since where
 * they are done is no more open to it; a plan limit is the one case `upgrade`
 * is a target (ADR-084 §2).
 */
export function capabilitiesOf(surface: SurfaceKind, limit: ChangeLimit = null): Capabilities {
  // What the page's turn can reach, not only what it enters with: a change the
  // entry persona hands to another by `switch_persona` is made from this page.
  // The widest each domain gets across the personas a switch can reach.
  const granted = new Map<ToolDomain, string>();
  const open = { role: "propose", plan: "propose", classifier: "propose" } as const;
  for (const id of reachable(ENTRY[surface], open, false)) {
    for (const { domain, max } of PERSONAS[id].grants) if (granted.get(domain) !== "propose") granted.set(domain, max);
  }
  const changes: string[] = [];
  const elsewhere: Capabilities["elsewhere"] = [];
  for (const domain of changeDomains()) {
    const change = CHANGE_IN[domain];
    // A change domain nobody described: the block would be silent about it, so
    // fail where the test can see it rather than in a prompt.
    if (change === null) throw new Error(`${domain} has a change tool and no line in CHANGE_IN`);
    if (limit !== null) continue;
    if (granted.get(domain) === "propose") changes.push(change);
    // A playbook is taken into a trip from the trip's own surface by
    // `insert_playbook_day`, so where `library` changes, it is not missing.
    else if (!(domain === "playbook" && granted.get("library") === "propose")) {
      elsewhere.push({ change, domain, to: routeFor(surface, domain) });
    }
  }
  const routed = new Set(elsewhere.flatMap((entry) => entry.to));
  const targets = HAND_OFF_TARGETS.filter(
    (target) => target === "nowhere" || target === "new_trip" || routed.has(target) || (target === "upgrade" && limit === "plan"),
  );
  return { changes, elsewhere, targets };
}

/**
 * Whether a turn in this persona, so limited and of this class, is offered
 * `show_options`: only beside a search that feeds it. The class narrows the
 * set as the turn's own grant does (a notebook compose turn holds no search),
 * and no class means a set nobody narrowed.
 */
function showsOptions(persona: PersonaId, limit: ChangeLimit, taskClass: TaskClass | undefined): boolean {
  const caps = { role: limit === "role" ? "read" : "propose", plan: limit === "plan" ? "read" : "propose", classifier: "propose" } as const;
  return toolsFor(grantForPersona(persona, caps), taskClass, postureFor(caps)).some((tool) => tool.name === SHOW_OPTIONS_TOOL_NAME);
}

const ROUTE_WORDS: Readonly<Record<CapabilityRoute, (aboutTrip: boolean) => string>> = {
  plan_page: (aboutTrip) => (aboutTrip ? `${HAND_OFF_TOOL_NAME} to "plan_page"` : `${HAND_OFF_TOOL_NAME} to "plan_page" with the trip they named`),
  new_trip: () => `${HAND_OFF_TOOL_NAME} to "new_trip" for a trip that does not exist yet, with what they said of it as its prefill and asks`,
  upgrade: () => `${HAND_OFF_TOOL_NAME} to "upgrade"`,
  nowhere: () => `${HAND_OFF_TOOL_NAME} to "nowhere"`,
  [GO_TO_TOOL_NAME]: () => `${GO_TO_TOOL_NAME} with the notebook, and they ask there`,
};

/** The `switch_persona` line for each persona the entry one hands work to, which is the edge list as the model reads it. */
function switchLines(persona: PersonaId): string[] {
  return switchTargetsOf(persona).map(
    (to) => `If the message needs ${PERSONAS[to].does}, call ${SWITCH_PERSONA_TOOL_NAME} with to: "${to}": your next step holds its tools, and you can switch once a turn.`,
  );
}

/** The block, as rules: what this page changes, where the rest is done, and how a turn ends instead of refusing. */
export function capabilityBlock(surface: SurfaceKind, limit: ChangeLimit = null, taskClass?: TaskClass): PromptBlock[] {
  const { changes, elsewhere } = capabilitiesOf(surface, limit);
  const aboutTrip = ABOUT_A_TRIP.has(surface);
  return [
    changes.length === 0 ? "From this page you can change nothing." : `From this page you can change ${changes.join("; ")}.`,
    // A limited turn is offered no `switch_persona` (a `steer` tool), so it is not told of one.
    ...(limit === null ? switchLines(ENTRY[surface]) : []),
    ...elsewhere.map(({ change, to }) => `Not from here: ${change}. For that, ${to.map((route) => ROUTE_WORDS[route](aboutTrip)).join(", or ")}.`),
    // A viewer's change is not a task done somewhere else: no page in this app
    // lets them make it, so a hand-off would point at nothing true.
    ...(limit === "role"
      ? ["Their role on this trip lets them read it, not change it: when they ask for a change to it, say so plainly in one sentence, with no hand_off."]
      : []),
    `When you understood ${limit === "role" ? "any other task" : "a task"} and cannot do it from here, never just say so: end the turn with ${HAND_OFF_TOOL_NAME}. A trip that does not exist yet is "new_trip". What nobody in this app can do (booking, payments, live prices, visas) is "nowhere", with one sentence.`,
    ...(limit === "plan" ? [`Their plan does not include changes: for a change they ask for, ${HAND_OFF_TOOL_NAME} to "upgrade".`] : []),
    `When a few answers would settle what they want, call ${ASK_USER_TOOL_NAME} instead of guessing or asking in prose.${
      // "Once you have its results": a day card is filled from what the search
      // returned when its step ends, so one called beside the search is refused.
      showsOptions(ENTRY[surface], limit, taskClass)
        ? ` To offer places or published days a search returned this turn, call ${SHOW_OPTIONS_TOOL_NAME} once you have its results.`
        : ""
    }`,
  ].map(rule);
}

/**
 * What a turn that switched to `persona` is told beside its entry instruction:
 * who it is now, that the one switch is spent, and `show_options` where its
 * set holds a search that feeds it. The entry instruction is kept whole, so
 * the thread reads as one conversation (ADR-085 D6).
 */
export function switchedBlock(persona: PersonaId, limit: ChangeLimit = null, taskClass?: TaskClass): PromptBlock[] {
  return [
    `You have switched to ${PERSONAS[persona].label}, for ${PERSONAS[persona].does}. You hold its tools now, and you cannot switch again this turn.`,
    ...(showsOptions(persona, limit, taskClass)
      ? [`To offer places or published days a search returned this turn, call ${SHOW_OPTIONS_TOOL_NAME} once you have its results.`]
      : []),
  ].map(rule);
}
