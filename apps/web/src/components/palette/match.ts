import type { PaletteCommand } from "./paletteRegistry";
import { byNearness, type PaletteNode, type PathSegment, paletteLevel, pathOf } from "./grammar";

// The palette's loose matching (M41 D9, ADR-069 §3 and §5): *go tokyo* finds
// Go to › Trip › Tokyo and *move ramen 3* Move › Stop › Ramen › Day 3, from
// any level and without drilling. A ranking rather than a filter, so the
// closest reading of what was typed is the one Enter takes.
//
// It ranks every node of the tree, branches as well as leaves, and a node is
// listed for what it is, not for what is above it (Mitchell, PR 398): *go* is
// the branch Go to, not the eight leaves under it, and *tokyo* is Tokyo, not
// every path through Go to.

/** How many rows a typed query shows (ADR-069 §5). */
export const PALETTE_ROWS = 8;

/** A step of a node's path from the top: what the trail holds once a branch is opened. */
export type PaletteStep = { key: string; label: string };

/**
 * A node a typed query lists. `steps` is its whole path, the levels already
 * opened included, so opening a branch found three deep sets the whole trail.
 * `child` marks a row listed under the top match, a branch, as one of its
 * children rather than as a match of its own.
 */
export type PaletteHit = { id: string; steps: readonly PaletteStep[]; node: PaletteNode; child?: true };

const branchId = (steps: readonly PaletteStep[]) => `branch:${JSON.stringify(steps.map((step) => step.key))}`;
const stepsOf = (segments: readonly PathSegment[]): PaletteStep[] => segments.map(({ key, label }) => ({ key, label }));

function leafHit(command: PaletteCommand): PaletteHit {
  const path = pathOf(command);
  return { id: `leaf:${command.id}`, steps: stepsOf(path), node: { kind: "leaf", key: command.id, label: path.at(-1)!.label, command } };
}

/**
 * How well `words` read as a walk along `path`, from `from` on, ending on its
 * last segment, as `[last, whole]` (lower is better), or `null` when they do
 * not. Each word must match a segment, in the path's order: skipping a
 * segment is fine, going back is not, and several words may land on one
 * segment ("kyoto in spring") so long as they read one text of it — its label
 * or one alias, so *go view* is not Go to by its label and its alias "view" at
 * once. The last word must land on the last segment. `last` is the best tier
 * scored there, `whole` the words' tiers summed; of every way the words can
 * land, the best last and then the best whole.
 *
 * Solved as a table over (word, segment, text), not by trying every landing:
 * that grows with the number of ways the words can fall, and it runs for
 * every node on every keystroke (PR 398 review, CodeRabbit). The words on the
 * last segment are a suffix of the query reading one text, so the answer is
 * the best way to place the rest before it, plus each such suffix.
 */
export function fit(words: readonly string[], path: readonly PathSegment[], from: number): [number, number] | null {
  const end = path.length - 1;
  const texts = path.map((segment) => [segment.label, ...segment.aliases].map((text) => text.toLowerCase()));
  // before[k]: the least sum that places words 0..k-1 on segments from..end-1.
  const before = [0];
  let row: number[][] = [];
  for (let w = 0; w < words.length - 1; w += 1) {
    const next: number[][] = [];
    // The best the previous word did on a segment before this one.
    let earlier = w === 0 ? 0 : Infinity;
    for (let s = from; s < end; s += 1) {
      next[s] = texts[s]!.map((text, t) => tier(text, words[w]!) + (w === 0 ? 0 : Math.min(earlier, row[s]![t]!)));
      if (w > 0) earlier = Math.min(earlier, ...row[s]!);
    }
    before.push(Math.min(Infinity, ...next.filter(Boolean).flat()));
    row = next;
  }
  let best: [number, number] | null = null;
  for (const text of texts[end]!) {
    let onLast = Infinity;
    let sum = 0;
    for (let k = words.length - 1; k >= 0; k -= 1) {
      const t = tier(text, words[k]!);
      if (t === Infinity) break;
      onLast = Math.min(onLast, t);
      sum += t;
      const whole = before[k]! + sum;
      if (whole < Infinity && (best === null || onLast < best[0] || (onLast === best[0] && whole < best[1]))) best = [onLast, whole];
    }
  }
  return best;
}

/**
 * Every node under `at` (the keys of the branches opened) that matches
 * `query`, best first (ADR-069 §3 and §5): by the node's own last segment's
 * tier, then shallower first, then the whole path's match, then nearness and
 * natural order (a branch's are its nearest leaf's). Uncapped;
 * {@link searchPalette} caps and groups.
 */
export function rankPalette(commands: readonly PaletteCommand[], query: string, at: readonly string[] = []): PaletteHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  const nodes = new Map<string, { hit: PaletteHit; segments: PathSegment[]; leaves: PaletteCommand[]; nearest: { command: PaletteCommand; index: number } }>();
  commands.forEach((command, index) => {
    const path = pathOf(command);
    if (path.length <= at.length || at.some((key, depth) => path[depth]!.key !== key)) return;
    for (let depth = at.length + 1; depth < path.length; depth += 1) {
      const segments = path.slice(0, depth);
      const steps = stepsOf(segments);
      const id = branchId(steps);
      const known = nodes.get(id);
      if (known !== undefined) {
        known.leaves.push(command);
        if (byNearness({ command, index }, known.nearest) < 0) known.nearest = { command, index };
        continue;
      }
      const leaves = [command];
      const last = segments.at(-1)!;
      nodes.set(id, { hit: { id, steps, node: { kind: "branch", key: last.key, label: last.label, leaves } }, segments, leaves, nearest: { command, index } });
    }
    const hit = leafHit(command);
    nodes.set(hit.id, { hit, segments: path, leaves: [command], nearest: { command, index } });
  });
  return [...nodes.values()]
    .flatMap((node) => {
      const score = fit(words, node.segments, at.length);
      return score === null ? [] : [{ ...node, score }];
    })
    .sort((a, b) => a.score[0] - b.score[0] || a.segments.length - b.segments.length || a.score[1] - b.score[1] || byNearness(a.nearest, b.nearest))
    .map((node) => node.hit);
}

/** A typed query's rows under one action's heading, best first. */
export type PaletteGroup = { action: PaletteCommand["action"]; hits: PaletteHit[] };

const actionOf = (hit: PaletteHit) => (hit.node.kind === "leaf" ? hit.node.command : hit.node.leaves[0]!).action;

/**
 * What a typed query shows: the best {@link PALETTE_ROWS} nodes, grouped by
 * action, the group of the best match first, so Enter still takes the best.
 * When the best is a branch its children come straight under it, so *go*
 * shows what Go to offers without opening it (ADR-069 §3).
 */
export function searchPalette(commands: readonly PaletteCommand[], query: string, at: readonly string[] = []): PaletteGroup[] {
  const ranked = rankPalette(commands, query, at);
  const top = ranked[0];
  const rows: PaletteHit[] = [];
  if (top?.node.kind === "branch") {
    rows.push(top);
    for (const node of paletteLevel(commands, top.steps.map((step) => step.key)) ?? []) {
      if (node.kind === "leaf") rows.push({ ...leafHit(node.command), child: true });
      else {
        const steps = [...top.steps, { key: node.key, label: node.label }];
        rows.push({ id: branchId(steps), steps, node, child: true });
      }
    }
  }
  // A child is not listed again as a match of its own.
  const listed = new Set(rows.map((row) => row.id));
  rows.push(...ranked.filter((hit) => !listed.has(hit.id)));

  // An action or a singleton is its own row, under no heading, so it never
  // splits its action's heading in two; the top's children stay with it.
  const groups: (PaletteGroup & { own: boolean })[] = [];
  for (const hit of rows.slice(0, PALETTE_ROWS)) {
    const action = actionOf(hit);
    const own = hit.steps.length === 1;
    const group = hit.child ? groups[0] : own ? undefined : groups.find((g) => g.action === action && !g.own);
    if (group) group.hits.push(hit);
    else groups.push({ action, hits: [hit], own });
  }
  return groups.map(({ action, hits }) => ({ action, hits }));
}

// The existing tiers (M41 D9), per segment: the whole of it, its start, the
// start of any word in it, anywhere in it, its letters in order.
function tier(text: string, word: string): number {
  if (text === word) return 0;
  if (text.startsWith(word)) return 1;
  if (text.split(/[\s—–·-]+/).some((part) => part.startsWith(word))) return 2;
  if (text.includes(word)) return 3;
  let at = 0;
  for (const letter of text) if (letter === word[at]) at += 1;
  return at === word.length ? 4 : Infinity;
}
