// Single source of truth for what every id-bearing field on a BatchableCommand
// MEANS — the metadata a raw `z.string().uuid()` can't carry on its own:
//   - `inject`  — server fills it; the AI never sees it (tripId).
//   - `mint`    — a brand-new entity id; the SERVER generates it so no UUID
//                 ever crosses the AI boundary. `entity` lets the batch
//                 projection register the new day/activity for later refs.
//   - `ref`     — points at something that must ALREADY exist; the AI names it
//                 by a human `<entity>Ref` ("day 2", a title) and the server
//                 resolves it. `backlog` says what a "no day" ref maps to:
//                 "omit" (optional dayId, e.g. AddActivity) or "null"
//                 (nullable toDayId, e.g. MoveActivity); absent = a real day is
//                 required (RemoveDay).
//
// Both the AI schema transform (planningTools) and the resolver (batchResolver)
// are DERIVED from this table — add a command and the mapped type below forces
// you to classify its id fields, and the enforcement test (idFields.test.ts)
// fails if a uuid field is left unclassified. tripId is handled globally as a
// universal inject, so it is intentionally NOT listed per command.
import type { BatchableCommand } from "@tc/contracts";

export type RefEntity = "activity" | "day" | "conflict";

export type IdRole =
  | { role: "inject" }
  | { role: "mint"; entity: RefEntity }
  | { role: "ref"; entity: RefEntity; backlog?: "null" | "omit" };

type CommandFieldName<K extends BatchableCommand["type"]> = keyof Extract<
  BatchableCommand,
  { type: K }
> &
  string;

// Every command type must appear (mapped over the union) or this won't compile.
export type IdFieldManifest = {
  [K in BatchableCommand["type"]]: Partial<Record<CommandFieldName<K>, IdRole>>;
};

const mint = (entity: RefEntity): IdRole => ({ role: "mint", entity });
const ref = (entity: RefEntity, backlog?: "null" | "omit"): IdRole => ({ role: "ref", entity, backlog });

export const ID_FIELDS: IdFieldManifest = {
  AddDay: { dayId: mint("day") },
  RemoveDay: { dayId: ref("day") },
  SetTripStartDate: {},
  AddActivity: { activityId: mint("activity"), dayId: ref("day", "omit") },
  UpdateActivity: { activityId: ref("activity") },
  MoveActivity: { activityId: ref("activity"), toDayId: ref("day", "null") },
  RemoveActivity: { activityId: ref("activity") },
  DismissConflict: { conflictId: ref("conflict") },
  SetTripCurrency: {},
  SetTripBudget: {},
};

// Model-facing parameter name for a ref field — e.g. a day ref is "dayRef".
// A command never has two refs to the same entity, so this never collides.
export function refParamName(entity: RefEntity): string {
  return `${entity}Ref`;
}

// The full set of ref param names the AI schema can expose — used to separate
// human refs from literal fields (title, position, …) when building commands.
export const REF_PARAM_NAMES: ReadonlySet<string> = new Set(
  (["activity", "day", "conflict"] as RefEntity[]).map(refParamName),
);
