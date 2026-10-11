// A small shell reader for the Bash hooks: splits a command into simple
// commands ("segments") of unquoted words, the way the shell would, so a hook
// can ask what a command RUNS instead of grepping its text.
//
// Why not a regex over the text: a heredoc that writes a file, a quoted commit
// message, or a `grep` for a phrase all contain the words a hook looks for
// without running them, and each one produced a false positive in review.
//
// What it understands: single and double quotes, backslash escapes, `;` `&`
// `|` and newlines as separators, `2>&1`-style redirections as words, comments,
// heredocs (their body is attached to the segment that opened them, never read
// as commands), and `$( ... )`. A substitution of the form
// `$(cat <<'EOF' ... EOF)` is replaced by the heredoc's body, which is how
// commit messages and PR bodies are usually passed; any other substitution
// keeps its raw text. It is not a full shell, and every caller fails open.

const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")"]);

// A heredoc delimiter: any run of characters the shell would not end a word
// on, so `<<'END-MSG'` and `<<EOF.md` read as heredocs, not as `<<` and text.
const DELIM = String.raw`([^\s'"<>;&|()]+)`;
// Sticky, so a match is tried at one index without slicing the command.
const HEREDOC_OP = new RegExp(String.raw`<<-?[ \t]*(['"]?)${DELIM}\1`, "y");
// Only the header: `${DELIM}\1[^\n]*\n` would backtrack quadratically on a
// long word with no newline, so the line's end is found with indexOf.
const CAT_HEREDOC = new RegExp(String.raw`^\s*cat\s*<<-?[ \t]*(['"]?)${DELIM}\1`);

/** A `<<` heredoc operator at `at`, as `{ delim, end }`, or null. */
function heredocAt(cmd, at) {
  HEREDOC_OP.lastIndex = at;
  const h = HEREDOC_OP.exec(cmd);
  return h ? { delim: h[2], end: at + h[0].length } : null;
}

/** The index just past the `"` that closes a span opened at `open`. */
function doubleQuoteEnd(cmd, open) {
  let i = open + 1;
  while (i < cmd.length && cmd[i] !== '"') {
    if (cmd[i] === "\\") i += 2;
    else if (cmd[i] === "$" && cmd[i + 1] === "(") i = substitutionEnd(cmd, i + 1);
    else i += 1;
  }
  return Math.min(i + 1, cmd.length);
}

/**
 * The end index (exclusive) of a `$(` substitution whose `(` is at `open`.
 * Quoted spans are skipped, so a `(` or `)` in a string does not count, and a
 * `$((...))` is arithmetic, where `<<` is a shift, not a heredoc.
 */
function substitutionEnd(cmd, open) {
  const arithmetic = cmd[open + 1] === "(";
  let depth = 1;
  let i = open + 1;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      i = j === -1 ? cmd.length : j + 1;
      continue;
    }
    if (c === '"') {
      i = doubleQuoteEnd(cmd, i);
      continue;
    }
    if (c === "<" && cmd[i + 1] === "<" && !arithmetic) {
      if (cmd[i + 2] === "<") {
        i += 3; // a here-string, `<<<word`
        continue;
      }
      const h = heredocAt(cmd, i);
      if (h) {
        i = heredocEnd(cmd, h.end, h.delim).next;
        continue;
      }
    }
    if (c === "(") depth += 1;
    if (c === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return cmd.length;
}

/**
 * A heredoc's body: the lines after the newline that follows `from`, up to the
 * line that is just `delim`. Returns the body, the index after that line, and
 * whether the line was found at all.
 */
function heredocEnd(cmd, from, delim) {
  const nl = cmd.indexOf("\n", from);
  if (nl === -1) return { body: "", next: cmd.length, found: false };
  const lines = [];
  let pos = nl + 1;
  while (pos <= cmd.length) {
    let eol = cmd.indexOf("\n", pos);
    if (eol === -1) eol = cmd.length;
    const line = cmd.slice(pos, eol);
    if (line.trim() === delim) return { body: lines.join("\n"), next: eol, found: true };
    lines.push(line);
    pos = eol + 1;
  }
  return { body: lines.join("\n"), next: cmd.length, found: false };
}

/**
 * What a `$( ... )` contributes to a word: the body of a lone `cat` heredoc,
 * else the raw text. Only the header is a regex; the body is found line by
 * line, because a lazy `[\s\S]*?` before the closing line was quadratic.
 */
function substitutionText(inner) {
  const m = CAT_HEREDOC.exec(inner);
  if (m) {
    const end = heredocEnd(inner, m[0].length, m[2]);
    if (end.found && inner.slice(end.next).trim() === "") return end.body;
  }
  return `$(${inner})`;
}

/**
 * Splits `cmd` into segments: `{ words, env, heredocs }`, where `env` holds the
 * leading `NAME=value` assignments, `words` the rest, and `heredocs` the
 * bodies fed to that segment.
 */
export function parseShell(input) {
  const cmd = String(input ?? "").replace(/\r/g, "");
  const segments = [];
  let words = [];
  let heredocs = [];
  let word = null;
  let pending = []; // heredocs opened on this line, read at its newline

  const pushWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    pushWord();
    if (words.length || heredocs.length) {
      let k = 0;
      while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k])) k += 1;
      segments.push({ env: words.slice(0, k), words: words.slice(k), heredocs });
    }
    words = [];
    heredocs = [];
  };

  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j === -1 ? cmd.length : j;
      word = (word ?? "") + cmd.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      let text = "";
      while (k < cmd.length && cmd[k] !== '"') {
        if (cmd[k] === "\\" && k + 1 < cmd.length) {
          text += cmd[k + 1];
          k += 2;
        } else if (cmd[k] === "$" && cmd[k + 1] === "(") {
          const end = substitutionEnd(cmd, k + 1);
          text += substitutionText(cmd.slice(k + 2, end - 1));
          k = end;
        } else {
          text += cmd[k];
          k += 1;
        }
      }
      word = (word ?? "") + text;
      i = k + 1;
      continue;
    }
    if (c === "\\") {
      if (cmd[i + 1] !== "\n") word = (word ?? "") + (cmd[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      const end = substitutionEnd(cmd, i + 1);
      word = (word ?? "") + substitutionText(cmd.slice(i + 2, end - 1));
      i = end;
      continue;
    }
    if (c === "#" && word === null) {
      const nl = cmd.indexOf("\n", i);
      i = nl === -1 ? cmd.length : nl;
      continue;
    }
    if (c === "<" && cmd[i + 1] === "<") {
      if (cmd[i + 2] === "<") {
        word = (word ?? "") + "<<<"; // a here-string, never a heredoc
        i += 3;
        continue;
      }
      const h = heredocAt(cmd, i);
      if (h) {
        pushWord();
        const slot = { body: "" };
        heredocs.push(slot);
        pending.push({ delim: h.delim, slot });
        i = h.end;
        continue;
      }
    }
    // `2>&1`, `&>file`, `>&2`: an `&` touching a redirection is not a separator.
    if (c === "&" && (cmd[i - 1] === ">" || cmd[i + 1] === ">")) {
      word = (word ?? "") + c;
      i += 1;
      continue;
    }
    if (c === "\n") {
      let next = i + 1;
      for (const p of pending) {
        const { body, next: after } = heredocEnd(cmd, next - 1, p.delim);
        p.slot.body = body;
        next = after + 1;
      }
      pending = [];
      endSegment();
      i = next;
      continue;
    }
    if (SEPARATORS.has(c)) {
      endSegment();
      i += 1;
      continue;
    }
    if (c === " " || c === "\t") {
      pushWord();
      i += 1;
      continue;
    }
    word = (word ?? "") + c;
    i += 1;
  }
  endSegment();
  return segments.map((s) => ({ ...s, heredocs: s.heredocs.map((h) => h.body) }));
}

/** True for a redirection word: `2>&1`, `>out`, `<in`, `&>log`, `>>`. */
export function isRedirection(word) {
  return /^(?:\d*|&)(?:>>?|<)/.test(word);
}

/** True for a redirection whose target is the NEXT word (`>`, `2>`, `>>`). */
export function redirectionTakesNext(word) {
  return /^(?:\d*|&)(?:>>?|<)$/.test(word);
}

/**
 * Words with redirections (and their separate targets) removed, so a
 * positional argument is never `2>&1` or a log file.
 */
export function withoutRedirections(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (isRedirection(words[i])) {
      if (redirectionTakesNext(words[i])) i += 1;
      continue;
    }
    out.push(words[i]);
  }
  return out;
}

/**
 * For a segment that runs `git [global options] <sub>`, the words after
 * `<sub>`; otherwise null. Global options are one token each, except `-C` and
 * `-c`, which take the next.
 */
export function gitSubcommandArgs(segment, sub) {
  const w = segment.words;
  if (w[0]?.split("/").pop() !== "git") return null;
  let i = 1;
  while (i < w.length && w[i].startsWith("-")) {
    i += w[i] === "-C" || w[i] === "-c" ? 2 : 1;
  }
  return w[i] === sub ? w.slice(i + 1) : null;
}
