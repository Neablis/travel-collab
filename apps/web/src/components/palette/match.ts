// The palette's loose matching (M41 D9): *cal* finds Calendar, *ns* finds New
// stop, and Enter runs whatever is first. A ranking rather than a filter, so
// the closest reading of what was typed is the one Enter takes.

/** What the matcher reads from a command: its label, and any other words it answers to. */
export type Matchable = { label: string; keywords?: readonly string[] };

/**
 * A keyword match ranks below a label match of the same kind or better (PR
 * 398 review): Account answers to "settings", but typing "settings" on a trip
 * means Trip settings, and "trip" means that rather than every trip. Past the
 * label's "anywhere in it", so a keyword said whole still beats a label whose
 * letters are only scattered.
 */
const KEYWORD_PENALTY = 3.5;

/**
 * The commands that match `query`, best first; every command, in its own
 * order, for an empty query. A better match is, in order: the whole word,
 * its start, the start of any word in it, anywhere in it, and its letters in
 * order; a keyword's match counts as a label's {@link KEYWORD_PENALTY} worse.
 * Ties keep the commands' own order, so the list never reshuffles between
 * equally good matches.
 */
export function rankCommands<T extends Matchable>(commands: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...commands];
  return commands
    .map((command, index) => ({
      command,
      index,
      score: Math.min(score(command.label.toLowerCase(), q), ...(command.keywords ?? []).map((w) => KEYWORD_PENALTY + score(w.toLowerCase(), q))),
    }))
    .filter((entry) => entry.score < Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}

function score(word: string, q: string): number {
  if (word === q) return 0;
  if (word.startsWith(q)) return 1;
  if (word.split(/[\s—–-]+/).some((part) => part.startsWith(q))) return 2;
  if (word.includes(q)) return 3;
  let at = 0;
  for (const letter of word) if (letter === q[at]) at += 1;
  return at === q.length ? 4 : Infinity;
}
