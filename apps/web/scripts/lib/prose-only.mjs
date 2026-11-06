// Which changes need no new production deployment (2026-11-06).
//
// The same three places CLAUDE.md's rule 4 calls prose: `docs/**`, `.claude/**`
// and a `*.md` at the repository root. Nothing under them is read by
// `next build`. Everything else counts as code, `content/` and `.design-sync/`
// included (`.design-sync/**` is a build input, AGENTS.md's Definition of Done).

/** True for a repository-relative path the app's build never reads. */
export function isProsePath(path) {
  if (path.startsWith("docs/") || path.startsWith(".claude/")) return true;
  return !path.includes("/") && path.endsWith(".md");
}

/** True when there is at least one changed path and every one is prose. */
export function isProseOnly(paths) {
  const changed = paths.filter((path) => path !== "");
  return changed.length > 0 && changed.every(isProsePath);
}
