import type { PaletteCommand } from "./paletteRegistry";
import { byNearness, pathOf, targetIndex } from "./grammar";

// The palette's loose matching (M41 D9, ADR-069 §3 and §5): *go tokyo* finds
// Go to › Trip › Tokyo and *move ramen 3* Move › Stop › Ramen › Day 3, from
// any level and without drilling. A ranking rather than a filter, so the
// closest reading of what was typed is the one Enter takes.

/** How many rows a typed query shows (ADR-069 §5). */
export const PALETTE_ROWS = 8;

// A word that matches no segment. Worse than every tier, so a path whose
// Target nothing typed reached ranks below one whose Target was typed.
const UNMATCHED = 5;

/**
 * How well `query` reads as a walk along `path`, from `from` on, as
 * `[target, whole]` (lower is better), or `null` when it does not. Each word
 * must match a segment, in the path's order: skipping a segment is fine,
 * going back is not, and several words may land on one segment ("kyoto in
 * spring"). `target` is the best tier any word scored on the Target, `whole`
 * the words' tiers summed; of every way the words can land, the best target
 * and then the best whole.
 */
function fit(words: readonly string[], command: PaletteCommand, from: number): [number, number] | null {
  const path = pathOf(command);
  const target = targetIndex(path);
  const tiers = words.map((word) => path.map((segment, index) => (index < from ? Infinity : Math.min(...[segment.label, ...segment.aliases].map((text) => tier(text.toLowerCase(), word))))));
  let best: [number, number] | null = null;
  const walk = (word: number, segment: number, onTarget: number, sum: number) => {
    if (word === words.length) {
      if (best === null || onTarget < best[0] || (onTarget === best[0] && sum < best[1])) best = [onTarget, sum];
      return;
    }
    for (let at = segment; at < path.length; at += 1) {
      const t = tiers[word]![at]!;
      if (t < Infinity) walk(word + 1, at, at === target ? Math.min(onTarget, t) : onTarget, sum + t);
    }
  };
  walk(0, from, UNMATCHED, 0);
  return best;
}

/**
 * The leaves under `at` (the keys of the branches opened) that match `query`,
 * best first (ADR-069 §5): by the Target's match, then the whole path's, then
 * nearness, then natural order. Uncapped; {@link searchPalette} caps and groups.
 */
export function rankLeaves(commands: readonly PaletteCommand[], query: string, at: readonly string[] = []): PaletteCommand[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  return commands
    .flatMap((command, index) => {
      const path = pathOf(command);
      if (path.length < at.length || at.some((key, depth) => path[depth]!.key !== key)) return [];
      const score = fit(words, command, at.length);
      return score === null ? [] : [{ command, index, score }];
    })
    .sort((a, b) => a.score[0] - b.score[0] || a.score[1] - b.score[1] || byNearness(a, b))
    .map((entry) => entry.command);
}

/** A typed query's rows under one action's heading, best first. */
export type PaletteGroup = { action: PaletteCommand["action"]; commands: PaletteCommand[] };

/**
 * What a typed query shows: the best {@link PALETTE_ROWS} leaves, grouped by
 * action, the group of the best match first, so Enter still takes the best.
 */
export function searchPalette(commands: readonly PaletteCommand[], query: string, at: readonly string[] = []): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  for (const command of rankLeaves(commands, query, at).slice(0, PALETTE_ROWS)) {
    const group = groups.find((g) => g.action === command.action);
    if (group) group.commands.push(command);
    else groups.push({ action: command.action, commands: [command] });
  }
  return groups;
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
