// **What a turn is for, per surface, and how it changes its mind** (ADR-058).
//
// Mitchell, 2026-09-26, after a notebook turn read every stop on a fourteen-day
// trip to decide which live widgets to insert: *"Notebooks should rarely need
// to scan the trip, these are generic widgets being inserted to display any
// trip, but when asking questions about a trip, you should know the trip shape.
// I would try to categorize the intent at start, insert the correct tools, but
// be able to pivot in the tool chain if we find ourself wrong partway
// through."*
//
// Three pieces, and each already had half a home:
//
//   * **the intent** is `TaskClass` — the classifier (`askIntent.ts`) already
//     picks one before the turn, and admission already narrows the tool set by
//     it (`defineTool`'s `taskClasses`). A page turn used to be `compose` by
//     construction and never classified; it is now classified between the two
//     intents its surface allows;
//   * **the profile** — which tools and which instruction — is the tools' own
//     `taskClasses` tags (the repo's rule: a tool's membership is stated on the
//     tool, never in a list elsewhere) plus one instruction table per surface
//     (`PAGE_INTENT_RULES` in handleAskRequest.ts);
//   * **the pivot** is `switch_intent` on a page, and on the board the
//     escalation M9 already built (`request_change_tools`), which is the same
//     move — question to edit — under an older name.
//
// This module is the table that ties them together: which intents each surface
// allows, which it starts in, what an intent needs granted, and the per-turn
// latch a pivot goes through. Since M57 part 4 the same latch holds the turn's
// persona, because a persona switch is the same kind of move (a charged step
// that changes what the next one holds); `switch_intent` and
// `request_change_tools` are the graph's self-loop edges, and `switch_persona`
// the one that changes persona (`personas.ts`).
import type { TaskClass } from "./taskClass";
import type { DomainCap, GrantedEffects, SurfaceKind } from "./grants";
import { EDGES, MAX_PERSONA_SWITCHES, guardHolds, switchTargetsOf, type PersonaId, type TurnCaps } from "./personas";

/** What a surface starts a turn in, what it may move to, and the tool that moves it. */
export interface SurfaceIntents {
  /** The intent a turn starts in when the classifier could not say. */
  default: TaskClass;
  /** Every intent a turn on this surface may be in — the classifier's choices, and a pivot's only targets. */
  allowed: readonly TaskClass[];
  /** The tool a turn pivots with. */
  pivot: "switch_intent" | "request_change_tools";
}

/**
 * **The surface table.** The phone is not a row: it asks through the same
 * `trip`, `day` and `page` scopes the desktop does, so it inherits these.
 *
 * `trip`/`day` start in `question` (a viewer's turn, and the classifier's
 * cheapest reading) and reach `edit` through M9's escalation; `plan` is
 * reachable only by the classifier. `page` starts in `compose` — the notebook
 * is what the surface is for — and reaches `question` for "how much is food
 * costing us?" asked beside the page.
 */
export const SURFACE_INTENTS: Readonly<Record<SurfaceKind, SurfaceIntents>> = {
  trip: { default: "question", allowed: ["question", "edit", "plan"], pivot: "request_change_tools" },
  day: { default: "question", allowed: ["question", "edit", "plan"], pivot: "request_change_tools" },
  page: { default: "compose", allowed: ["compose", "question"], pivot: "switch_intent" },
  // Questions only, so nowhere to pivot to: its grant holds no `system` or
  // `pages` domain, so neither pivot tool can ever be offered on it.
  account: { default: "question", allowed: ["question"], pivot: "request_change_tools" },
  // The playbook pages likewise (M45 D9): their classifier is only the
  // off-topic gate, and a shared day's two writes are offered on every turn,
  // because the page's buttons are, so no intent has to be reached for them.
  "playbook-day": { default: "question", allowed: ["question"], pivot: "request_change_tools" },
  playbook: { default: "question", allowed: ["question"], pivot: "request_change_tools" },
  discover: { default: "question", allowed: ["question"], pivot: "request_change_tools" },
  city: { default: "question", allowed: ["question"], pivot: "request_change_tools" },
  tag: { default: "question", allowed: ["question"], pivot: "request_change_tools" },
};

/**
 * What an intent needs GRANTED before a turn may be in it. `question` needs
 * nothing a turn does not already hold; the three that write need their
 * domain at `propose`.
 *
 * **This is what keeps a pivot inside the grant.** A pivot changes which of the
 * turn's own tools are active; it never widens what `grantFor` computed, so an
 * intent whose domain the grant holds at `read` is simply not reachable — a
 * viewer cannot pivot into composing a page, whatever it asks for.
 */
export const INTENT_REQUIRES: Readonly<Record<TaskClass, DomainCap | null>> = {
  question: null,
  edit: { domain: "itinerary", max: "propose" },
  plan: { domain: "itinerary", max: "propose" },
  compose: { domain: "pages", max: "propose" },
};

/** The intents a turn on `surface` holding `grants` may be in, in the surface's own order. */
export function reachableIntents(surface: SurfaceKind, grants: GrantedEffects): TaskClass[] {
  return SURFACE_INTENTS[surface].allowed.filter((intent) => {
    const needs = INTENT_REQUIRES[intent];
    return needs === null || grants[needs.domain] === needs.max;
  });
}

/**
 * Pivots one turn may make. Two, not one: a compose turn that asks a question
 * mid-way and then goes back to writing is two honest pivots, and a third is a
 * model oscillating rather than a classifier that was wrong.
 */
export const MAX_PIVOTS = 2;

/** One mid-turn change of intent: from what, to what, why, and after which step. */
export interface AskPivot {
  from: TaskClass;
  to: TaskClass;
  reason: string;
  /** How many steps had finished when the pivot was asked for — 0 means on the first step. */
  step: number;
}

/**
 * The turn's intent, and the only way it changes.
 *
 * Minted per turn beside the other collectors. `prepareStep` reads `current()`
 * before every step to choose the active tools, the model and the
 * instruction, so a pivot takes effect on the NEXT step — the one the model
 * that asked for it is about to take.
 */
export interface IntentLatch {
  current(): TaskClass;
  reachable(): readonly TaskClass[];
  /** Move to `to`, or say why not. Never throws: a refused pivot is something the model can act on. */
  request(to: TaskClass, reason: string): { ok: true } | { ok: false; refused: string };
  pivots(): AskPivot[];
  /** The persona the turn is in now (M57). The entry persona until a switch. */
  persona(): PersonaId;
  /**
   * Cross a `switch_persona` edge to `to`, or say why not. The server's own
   * check, whatever the tool's schema allowed: the edge must leave the current
   * persona, its guard must hold under the turn's caps, and the turn's switches
   * must not be spent. Never throws, for the reason `request` does not.
   */
  switchPersona(to: PersonaId, why: string): { ok: true } | { ok: false; refused: string };
  switches(): PersonaSwitch[];
}

/** One mid-turn change of persona (M57): where from, where to, why, and after which step. */
export interface PersonaSwitch {
  from: PersonaId;
  to: PersonaId;
  why: string;
  /** How many steps had finished when the switch was asked for. */
  step: number;
}

/** Where a turn's persona starts and the caps its edges' guards are read against. */
export interface PersonaStart {
  entry: PersonaId;
  caps: TurnCaps;
}

/** One turn's latch: an intent starting in `start` able to reach only `reachable`, at most `max` times, and a persona starting at `persona.entry`. */
export function newIntentLatch(
  start: TaskClass,
  reachable: readonly TaskClass[],
  stepsTaken: () => number,
  persona: PersonaStart,
  max: number = MAX_PIVOTS,
): IntentLatch {
  let current = start;
  let inPersona = persona.entry;
  const pivots: AskPivot[] = [];
  const switches: PersonaSwitch[] = [];
  return {
    current: () => current,
    reachable: () => reachable,
    request: (to, reason) => {
      if (to === current) return { ok: false, refused: `This turn is already ${to}; carry on with the tools you have.` };
      if (!reachable.includes(to)) {
        return {
          ok: false,
          refused: `${to} is not open to this turn. It can be: ${reachable.join(", ")}.`,
        };
      }
      if (pivots.length >= max) {
        return { ok: false, refused: `This turn has already switched ${max} times. Finish with the tools you have.` };
      }
      pivots.push({ from: current, to, reason, step: stepsTaken() });
      current = to;
      return { ok: true };
    },
    pivots: () => [...pivots],
    persona: () => inPersona,
    switchPersona: (to, why) => {
      if (switches.length >= MAX_PERSONA_SWITCHES) {
        return { ok: false, refused: `This turn has already switched persona ${MAX_PERSONA_SWITCHES} time${MAX_PERSONA_SWITCHES === 1 ? "" : "s"}. Finish with the tools you have.` };
      }
      const targets = switchTargetsOf(inPersona);
      const edge = EDGES.find((e) => e.kind === "switch" && e.via === "switch_persona" && e.from === inPersona && e.to === to);
      if (edge === undefined) {
        return { ok: false, refused: `${to} is not open from ${inPersona}. It can be: ${targets.join(", ") || "nothing"}.` };
      }
      if (!guardHolds(edge.guard, persona.caps)) {
        return { ok: false, refused: `This turn's permissions do not allow switching to ${to}.` };
      }
      switches.push({ from: inPersona, to, why, step: stepsTaken() });
      inPersona = to;
      return { ok: true };
    },
    switches: () => [...switches],
  };
}
