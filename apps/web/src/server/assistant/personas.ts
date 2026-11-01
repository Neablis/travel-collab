// **The assistant as a graph of personas** (M57, ADR-085).
//
// A persona is a named grant, the page kinds that enter it, and the edges that
// leave it. `SURFACES` (grants.ts) is derived from this table, so "which tools
// exist where" and the graph around it have one statement. The five personas
// are the five distinct tool sets the nine surfaces hold, and since part 4 the
// old trip planner is two: Schedule, which a trip or day page enters, and
// Discover, which holds everything Schedule does plus the search tools.
//
// Pure data and pure functions: the reachability baseline and the Mermaid
// drawing are both read off it (`personaReachability.test.ts`).
//
// **Two kinds of switch edge.** A self-loop (`request_change_tools`,
// `switch_intent`) moves the turn between modes inside one persona, so the
// reachability baseline, which records persona sets, cannot see it; the
// `switch_persona` edge between Schedule and Discover changes persona and is in
// the baseline. A hand-off to nowhere enters neither. Self-loops and every
// guard are pinned by `personas.test.ts` and by the drift check on
// `docs/architecture/personas.mmd`, whose diff is where a dropped guard shows.
//
// **`switch_intent` is the page writer's pivot**, a `pages` tool; the
// scheduler's and the discoverer's is `request_change_tools`, the `system`
// escalation. A turn makes at most `MAX_PERSONA_SWITCHES` persona changes.
import type { DomainCap, SurfaceGrant, SurfaceKind } from "./grants";
import type { EffectLevel } from "./defineTool";

export type PersonaId = "schedule" | "discover" | "page-writer" | "account" | "playbook-editor" | "explorer";

export interface Persona {
  id: PersonaId;
  /** What a person-facing label would say; operators only (D4), never shown to people. */
  label: string;
  /** What this persona does, as another persona's `switch_persona` line says it (a verb phrase). */
  does: string;
  /** The most this persona grants per domain, before the role, plan and classifier caps lower it. */
  grants: SurfaceGrant;
}

const UI: DomainCap = { domain: "ui", max: "read" };

export const PERSONAS = {
  // **Schedule is the trip planner without discovery** (M57 part 4): the
  // trip's plan and nothing that looks the world up. It is what a trip or day
  // page enters, because most edits ("move lunch to 1pm") need no search, and
  // the search tools (`search_places`, `search_playbooks`, `show_options`) and
  // their instruction lines are what a step pays for on every call.
  schedule: {
    id: "schedule",
    label: "Schedule",
    does: "arranging the trip's days, stops and times",
    grants: [
      { domain: "itinerary", max: "propose" },
      // **`system` is the turn talking about itself**, not about the trip. Its
      // members are M9's escalation tool, further narrowed to a single POSTURE
      // by `defineTool`'s `postures`, and `switch_persona`, which exists only
      // where an edge leaves the persona. This row grants the domain; those
      // tags are what stop either being offered on every turn the row reaches.
      // Two filters rather than one: this table answers "which personas have
      // system tools at all", the tag answers "when is this one safe".
      { domain: "system", max: "read" },
      // ADR-084 §3: every persona ends a turn the same ways when prose would
      // strand the person. `read` because nothing in it changes anything.
      UI,
    ],
  },
  // **Discover is the whole of what the trip planner held** before the split,
  // and it has to be: a stop that names a real place cites a `search_places`
  // result by `placeRef` (M9 grounding), and the server resolves a number only
  // in the turn that searched, so the search and the write that cites it
  // belong to one persona. A turn makes one switch, so there is no hopping back
  // to Schedule to write what Discover found.
  discover: {
    id: "discover",
    label: "Discover",
    does: "finding real places or published playbook days, and adding them to the trip",
    grants: [
      { domain: "itinerary", max: "propose" },
      { domain: "library", max: "propose" },
      // `read`, and it can never be more: `places` has no `propose` tool and the
      // domain is a gazetteer lookup, not a change. Capped here rather than left
      // to the tool's own `effect`, because the table is the thing a reader
      // checks to answer "could a page turn ever spend the vendor key?".
      { domain: "places", max: "read" },
      { domain: "system", max: "read" },
      UI,
    ],
  },
  // A page turn reads the trip and writes the page. `library` stays at `read`
  // rather than being left out, because a page turn browses the corpus
  // (`search_playbooks`) and only the `library` row keeps it. `itinerary` and
  // `library` carry the same cap here as on the trip planner, so retagging
  // either library tool would change no tool set; the tags are pinned directly
  // in `grants.test.ts` because nothing in this table can pin them.
  //
  // **No `places` row, deliberately, and the reason is SCOPE rather than
  // citations.** A page turn writes a document out of what the trip already
  // contains (`insert_text` over readouts), so the gazetteer is not a source it
  // draws on; a trip turn answers about the trip AND the world around it. This
  // is the first row where leaving a domain out is a decision rather than the
  // absence of a tool.
  //
  // **No `system` row either, and that one is moot.** A page turn's classifier
  // picks a profile and never an effect (ADR-058), so its posture is never
  // `withheld`, the only posture the one system tool is offered in. The page's
  // own pivot, `switch_intent`, is in the `pages` domain.
  "page-writer": {
    id: "page-writer",
    label: "Page writer",
    does: "writing the notebook page",
    grants: [
      { domain: "itinerary", max: "read" },
      { domain: "library", max: "read" },
      { domain: "pages", max: "propose" },
      UI,
    ],
  },
  // **Reads across trips and writes nothing** (M45). One domain, at `read`, and
  // no trip domain at all: there is no one trip for `read_trip` to read. `go_to`
  // is an `itinerary` tool, so its account twin, `open_trip`, is in this domain
  // and names the trip in its input.
  account: { id: "account", label: "Account", does: "reading across their trips", grants: [{ domain: "account", max: "read" }, UI] },
  // **Each playbook page sees what is on it and nothing else** (M45 D9). A
  // shared day reads the playbook on screen and may take it into a trip the
  // person names, the two buttons it already has. No trip domain.
  "playbook-editor": { id: "playbook-editor", label: "Playbook editor", does: "reading a shared playbook", grants: [{ domain: "playbook", max: "propose" }, UI] },
  // A list page reads its own list and writes nothing, because it has no button that does.
  explorer: { id: "explorer", label: "Explorer", does: "browsing the playbook list", grants: [{ domain: "playbookList", max: "read" }, UI] },
} as const satisfies Record<PersonaId, Persona>;

/**
 * Where each page kind enters. The nine surfaces are kept because D9 names each
 * playbook page as what it sees: a row per page is where one of them comes to
 * differ. Key order is `SURFACES`' order, which tests iterate.
 */
export const ENTRY: Readonly<Record<SurfaceKind, PersonaId>> = {
  trip: "schedule",
  day: "schedule",
  page: "page-writer",
  account: "account",
  "playbook-day": "playbook-editor",
  playbook: "playbook-editor",
  discover: "explorer",
  city: "explorer",
  tag: "explorer",
};

/** The turn's three caps that are not the page's (grants.ts `EffectCaps`). */
export interface TurnCaps {
  role: EffectLevel;
  plan: EffectLevel;
  classifier: EffectLevel;
}

/** An edge is taken only when every cap it names has exactly this value. */
export type Guard = Readonly<Partial<TurnCaps>>;

/**
 * `switch` moves the turn to a persona's tools mid-turn; `hand-off` is
 * ADR-084's button, which ends the turn and sends the person somewhere. A
 * hand-off whose `to` is null leaves the graph: nowhere in this app serves it.
 */
export type Edge =
  | { from: PersonaId; to: PersonaId; kind: "switch"; via: "switch_intent" | "request_change_tools" | "switch_persona"; guard: Guard }
  | { from: PersonaId; to: PersonaId | null; kind: "hand-off"; via: "new_trip" | "plan_page" | "upgrade" | "nowhere" | "go_to" | "open_trip"; guard: Guard };

const EDITS: Guard = { role: "propose", plan: "propose" };

// Hand-offs every persona has: a trip that does not exist yet, and what nobody can do.
const ANYWHERE = (from: PersonaId): Edge[] => [
  { from, to: null, kind: "hand-off", via: "new_trip", guard: {} },
  { from, to: null, kind: "hand-off", via: "nowhere", guard: {} },
  // ADR-084 §2: only a person held back by their plan is sent to upgrade; a role limit wins.
  { from, to: null, kind: "hand-off", via: "upgrade", guard: { role: "propose", plan: "read" } },
];

export const EDGES: readonly Edge[] = [
  // The board's escalation (M9): a question turn asks for the write tools.
  // On both trip personas, since either can be the one a question turn is in.
  { from: "schedule", to: "schedule", kind: "switch", via: "request_change_tools", guard: { ...EDITS, classifier: "read" } },
  { from: "discover", to: "discover", kind: "switch", via: "request_change_tools", guard: { ...EDITS, classifier: "read" } },
  // The page's pivot (ADR-058): compose and question trade places within the page.
  { from: "page-writer", to: "page-writer", kind: "switch", via: "switch_intent", guard: EDITS },
  // Schedule to Discover and back. No classifier cap in the guard: a question
  // turn needs to look something up as much as an edit turn does. The role and
  // plan are what the guard names because `switch_persona` is a `steer` tool,
  // which a read-only turn is never offered.
  { from: "schedule", to: "discover", kind: "switch", via: "switch_persona", guard: EDITS },
  { from: "discover", to: "schedule", kind: "switch", via: "switch_persona", guard: EDITS },
  // A notebook is one `go_to` away from a trip.
  { from: "schedule", to: "page-writer", kind: "hand-off", via: "go_to", guard: EDITS },
  { from: "discover", to: "page-writer", kind: "hand-off", via: "go_to", guard: EDITS },
  { from: "account", to: "schedule", kind: "hand-off", via: "open_trip", guard: {} },
  ...(["page-writer", "account", "playbook-editor", "explorer"] as const).map((from): Edge => ({ from, to: "schedule", kind: "hand-off", via: "plan_page", guard: EDITS })),
  ...(Object.keys(PERSONAS) as PersonaId[]).flatMap(ANYWHERE),
];

/**
 * Persona changes one turn may make (ADR-085 decision 4). One: a switch costs
 * a step, and multi-agent setups multiply tokens. The ADR-058 intent pivot
 * allows two because a compose turn that asks a question and returns is two
 * honest moves; Discover holds all of Schedule's tools, so no turn needs to
 * come back.
 */
export const MAX_PERSONA_SWITCHES = 1;

/** The personas a `switch_persona` edge leads to from `from`, in table order. Self-loops are modes, not persona changes. */
export function switchTargetsOf(from: PersonaId): PersonaId[] {
  return (Object.keys(PERSONAS) as PersonaId[]).filter((to) =>
    EDGES.some((edge) => edge.kind === "switch" && edge.via === "switch_persona" && edge.from === from && edge.to === to),
  );
}

/** SURFACES, derived: each page kind holds the grant of the persona it enters. */
export function surfaceGrants(): Record<SurfaceKind, SurfaceGrant> {
  const grants = {} as Record<SurfaceKind, SurfaceGrant>;
  for (const kind of Object.keys(ENTRY) as SurfaceKind[]) grants[kind] = PERSONAS[ENTRY[kind]].grants;
  return grants;
}

/** Whether the turn's caps satisfy every cap an edge names. */
export function guardHolds(guard: Guard, caps: TurnCaps): boolean {
  return (Object.keys(guard) as (keyof TurnCaps)[]).every((cap) => guard[cap] === caps[cap]);
}

/**
 * The personas a turn can be in, starting at `from` under `caps`. `switch`
 * edges are the turn's own; with `handOffs` the button edges count too, which
 * is "where a person can end up from here".
 */
export function reachable(from: PersonaId, caps: TurnCaps, handOffs: boolean): PersonaId[] {
  const seen = new Set<PersonaId>([from]);
  for (let queue = [from]; queue.length > 0; ) {
    const here = queue.shift()!;
    for (const edge of EDGES) {
      if (edge.from !== here || edge.to === null || seen.has(edge.to)) continue;
      if ((edge.kind === "hand-off" && !handOffs) || !guardHolds(edge.guard, caps)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return (Object.keys(PERSONAS) as PersonaId[]).filter((id) => seen.has(id));
}

function guardText(guard: Guard): string {
  const parts = Object.entries(guard).map(([cap, value]) => `${cap}=${value}`);
  return parts.length === 0 ? "" : ` [${parts.join(" ")}]`;
}

/** The graph as Mermaid, for `docs/architecture/personas.mmd` (drift-checked by the reachability test). */
export function personaMermaid(): string {
  const lines = ["%% Generated from apps/web/src/server/assistant/personas.ts. Do not edit; see personaReachability.test.ts.", "flowchart LR"];
  for (const persona of Object.values(PERSONAS)) lines.push(`  ${persona.id.replaceAll("-", "_")}["${persona.label}"]`);
  lines.push('  nowhere(("leaves the graph"))');
  for (const kind of Object.keys(ENTRY) as SurfaceKind[]) lines.push(`  page_${kind.replaceAll("-", "_")}(["${kind} page"]) --> ${ENTRY[kind].replaceAll("-", "_")}`);
  for (const edge of EDGES) {
    const arrow = edge.kind === "switch" ? "==>" : "-->";
    lines.push(`  ${edge.from.replaceAll("-", "_")} ${arrow}|"${edge.via}${guardText(edge.guard)}"| ${edge.to === null ? "nowhere" : edge.to.replaceAll("-", "_")}`);
  }
  return `${lines.join("\n")}\n`;
}
