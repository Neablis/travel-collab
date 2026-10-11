// Regex source for a `git` command word plus its global options, ending just
// before the subcommand: `FOO=1 git -C . --no-pager -c a=b` in front of
// `commit`. Callers append `\s+<subcommand>\b` and supply the segment start.
//
// Each option is ONE whitespace-delimited token starting with `-`, and only
// `-c`/`-C` may take a separate value token, which must not start with `-`.
// That keeps every token's parse unique, so matching is linear. The earlier
// form, `(?:\s+-[cC]\s*\S+|\s+--?[\w-]+(?:=\S+)?)*`, let both arms claim the
// same token and split `\S+` many ways: `git -C=! -C=! ...` with no subcommand
// backtracked exponentially (CodeQL js/redos). Tokens stop at `;|&` so a
// value can never swallow the next command.
export const GIT_WITH_GLOBAL_OPTS =
  String.raw`(?:[A-Za-z_]\w*=\S*\s+)*git\b(?:\s+-[cC]\s+[^\s;|&-][^\s;|&]*|\s+-[^\s;|&]+)*`;
