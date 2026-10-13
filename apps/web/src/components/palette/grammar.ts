import type { PaletteAction, PaletteCommand, PaletteNearness, PaletteSingleton, PaletteType } from "./paletteRegistry";

// **The palette's grammar** (ADR-069): every command is a path, *Action ›
// Type › Target [› Destination]*, and the drill-in tree is derived here from
// the flat list of leaves the screens register. A branch is a prefix two or
// more leaves share, or one leaf's prefix; nothing registers a branch, so a
// branch with nothing under it cannot exist.

/** The actions, in the order the empty palette lists them (ADR-069 §2). */
export const ACTIONS: readonly PaletteAction[] = ["Go to", "Add", "Edit", "Move", "Remove"];
const SINGLETONS: readonly PaletteSingleton[] = ["Undo", "Redo", "Ask the assistant", "Open chat"];
const TYPES: readonly PaletteType[] = ["Trip", "Day", "Stop", "View", "Notebook", "Page"];

// ADR-069 §3. The vocabulary's own words, so no screen can spell "delete"
// differently from another.
const ALIASES: Record<PaletteAction | PaletteSingleton | PaletteType, readonly string[]> = {
  "Go to": ["open", "view", "switch"],
  Add: ["new", "create"],
  Edit: ["change", "rename"],
  Move: [],
  Remove: ["delete"],
  Undo: ["revert"],
  Redo: [],
  // Not "chat": that is the trip's conversation with its people (M46), and
  // the two are never one another's alias.
  "Ask the assistant": ["ai"],
  "Open chat": ["message", "conversation"],
  Trip: [],
  Day: [],
  Stop: ["activity", "place"],
  View: ["lens"],
  Notebook: [],
  Page: [],
};

/** One step of a command's path, with what it is in the grammar. */
export type PathSegment = {
  role: "action" | "type" | "target" | "destination";
  /** Identifies the segment among its siblings: the branch two leaves share has one key. */
  key: string;
  label: string;
  aliases: readonly string[];
};

/** A command's path, action first; a singleton's is its one segment. */
export function pathOf(command: PaletteCommand): PathSegment[] {
  const path: PathSegment[] = [{ role: "action", key: command.action, label: command.action, aliases: ALIASES[command.action] }];
  if (command.type !== undefined) path.push({ role: "type", key: command.type, label: command.type, aliases: ALIASES[command.type] });
  for (const role of ["target", "destination"] as const) {
    const segment = command[role];
    if (segment !== undefined) path.push({ role, key: segment.key ?? segment.label, label: segment.label, aliases: segment.aliases ?? [] });
  }
  return path;
}

const NEARNESS: Record<PaletteNearness, number> = { focused: 0, selected: 1, trip: 2, global: 3 };

/**
 * Orders commands by where you are and then their natural order (ADR-069 §5),
 * for the ties match quality leaves; `index` is each command's place in the
 * registry, the last word.
 */
export function byNearness(a: { command: PaletteCommand; index: number }, b: { command: PaletteCommand; index: number }): number {
  return (
    NEARNESS[a.command.nearness ?? "global"] - NEARNESS[b.command.nearness ?? "global"] ||
    (a.command.order ?? 0) - (b.command.order ?? 0) ||
    a.index - b.index
  );
}

/** A row of a drill-in level: a branch to open, or a leaf to run. */
export type PaletteNode =
  | { kind: "branch"; key: string; label: string; leaves: readonly PaletteCommand[] }
  | { kind: "leaf"; key: string; label: string; command: PaletteCommand };

/**
 * What the palette lists inside `at` (the keys of the branches opened so far),
 * or `null` when `at` no longer leads anywhere — the commands under it went
 * while it was open. At the top: the actions, then the singletons, each only
 * if something is under it. The closed sets (actions, types) keep the
 * vocabulary's order, so they never move; targets and destinations come by
 * their nearest leaf (`byNearness`).
 *
 * A leaf that is also a prefix of another path is a branch here: drilling
 * cannot reach it, typing still can.
 */
export function paletteLevel(commands: readonly PaletteCommand[], at: readonly string[]): PaletteNode[] | null {
  const groups = new Map<string, { label: string; role: PathSegment["role"]; entries: { command: PaletteCommand; index: number; ends: boolean }[] }>();
  commands.forEach((command, index) => {
    const path = pathOf(command);
    if (path.length <= at.length || at.some((key, depth) => path[depth]!.key !== key)) return;
    const segment = path[at.length]!;
    const group = groups.get(segment.key) ?? { label: segment.label, role: segment.role, entries: [] };
    group.entries.push({ command, index, ends: path.length === at.length + 1 });
    groups.set(segment.key, group);
  });
  if (groups.size === 0) return at.length === 0 ? [] : null;

  const vocabulary: readonly string[] = [...ACTIONS, ...SINGLETONS, ...TYPES];
  const ordered = [...groups.entries()].sort(([aKey, a], [bKey, b]) => {
    if (a.role === "action" || a.role === "type") return vocabulary.indexOf(aKey) - vocabulary.indexOf(bKey);
    const nearest = (entries: typeof a.entries) => [...entries].sort(byNearness)[0]!;
    return byNearness(nearest(a.entries), nearest(b.entries));
  });
  return ordered.flatMap(([key, group]): PaletteNode[] =>
    group.entries.every((entry) => entry.ends)
      ? group.entries.map((entry) => ({ kind: "leaf", key: entry.command.id, label: group.label, command: entry.command }))
      : [{ kind: "branch", key, label: group.label, leaves: group.entries.filter((entry) => !entry.ends).map((entry) => entry.command) }],
  );
}

/** A command's path as the palette writes it, from segment `from` on: "Move › Stop › Ramen › Day 3". */
export function pathText(command: PaletteCommand, from = 0): string {
  return pathOf(command)
    .slice(from)
    .map((segment) => segment.label)
    .join(" › ");
}
