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
import { SURFACES, type SurfaceKind } from "./grants";
import { rule, type PromptBlock } from "./prompt";
import { ASSISTANT_TOOLS } from "./registry";
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
  playbook: "this playbook taken into a trip",
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
 * The surface's capabilities. `upgradable` is a turn whose plan holds no
 * changes, the one case `upgrade` is a target (ADR-084 §2).
 */
export function capabilitiesOf(surface: SurfaceKind, upgradable = false): Capabilities {
  const granted = new Map<ToolDomain, string>(SURFACES[surface].map(({ domain, max }) => [domain, max]));
  const changes: string[] = [];
  const elsewhere: Capabilities["elsewhere"] = [];
  for (const domain of changeDomains()) {
    const change = CHANGE_IN[domain];
    // A change domain nobody described: the block would be silent about it, so
    // fail where the test can see it rather than in a prompt.
    if (change === null) throw new Error(`${domain} has a change tool and no line in CHANGE_IN`);
    if (granted.get(domain) === "propose") changes.push(change);
    // A playbook is taken into a trip from the trip's own surface by
    // `insert_playbook_day`, so where `library` changes, it is not missing.
    else if (!(domain === "playbook" && granted.get("library") === "propose")) {
      elsewhere.push({ change, domain, to: routeFor(surface, domain) });
    }
  }
  const routed = new Set(elsewhere.flatMap((entry) => entry.to));
  const targets = HAND_OFF_TARGETS.filter(
    (target) => target === "nowhere" || target === "new_trip" || routed.has(target) || (target === "upgrade" && upgradable),
  );
  return { changes, elsewhere, targets };
}

const ROUTE_WORDS: Readonly<Record<CapabilityRoute, (aboutTrip: boolean) => string>> = {
  plan_page: (aboutTrip) => (aboutTrip ? `${HAND_OFF_TOOL_NAME} to "plan_page"` : `${HAND_OFF_TOOL_NAME} to "plan_page" with the trip they named`),
  new_trip: () => `${HAND_OFF_TOOL_NAME} to "new_trip" for a trip that does not exist yet`,
  upgrade: () => `${HAND_OFF_TOOL_NAME} to "upgrade"`,
  nowhere: () => `${HAND_OFF_TOOL_NAME} to "nowhere"`,
  [GO_TO_TOOL_NAME]: () => `${GO_TO_TOOL_NAME} with the notebook, and they ask there`,
};

/** The block, as rules: what this page changes, where the rest is done, and how a turn ends instead of refusing. */
export function capabilityBlock(surface: SurfaceKind, upgradable = false): PromptBlock[] {
  const { changes, elsewhere } = capabilitiesOf(surface, upgradable);
  const aboutTrip = ABOUT_A_TRIP.has(surface);
  return [
    changes.length === 0 ? "From this page you can change nothing." : `From this page you can change ${changes.join("; ")}.`,
    ...elsewhere.map(({ change, to }) => `Not from here: ${change}. For that, ${to.map((route) => ROUTE_WORDS[route](aboutTrip)).join(", or ")}.`),
    `When you understood a task and cannot do it from here, never just say so: end the turn with ${HAND_OFF_TOOL_NAME}. A trip that does not exist yet is "new_trip". What nobody in this app can do (booking, payments, live prices, visas) is "nowhere", with one sentence.`,
    ...(upgradable ? [`Their plan does not include changes: for a change they ask for, ${HAND_OFF_TOOL_NAME} to "upgrade".`] : []),
    `When a few answers would settle what they want, call ${ASK_USER_TOOL_NAME} instead of guessing or asking in prose. To offer places or published days a tool returned this turn, call ${SHOW_OPTIONS_TOOL_NAME}.`,
  ].map(rule);
}
