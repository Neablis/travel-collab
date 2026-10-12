import { closeSync, fstatSync, openSync, readSync } from "node:fs";

// What a transcript says about its agent's most recent call: when its last
// record was written, and how many tokens the last assistant call carried.
// A hook is given no context size by the harness; the transcript's `usage` is
// the only place it is recorded.

// The last assistant record is near the end; a transcript can be tens of MB.
const TAIL_BYTES = 8 * 1024 * 1024;

function tailLines(file) {
  const fd = openSync(file, "r");
  try {
    const { size } = fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // cut mid-record
    return lines;
  } finally {
    closeSync(fd);
  }
}

/**
 * `{ lastAt, context }` for the transcript at `file`: epoch ms of its last
 * record and the tokens of its last assistant call, each null when not found.
 * Throws when the file cannot be read, so a caller can tell "no transcript"
 * from "a transcript with nothing in it".
 */
export function lastCall(file) {
  const lines = tailLines(file);
  let lastAt = null;
  let context = null;
  for (let i = lines.length - 1; i >= 0 && (lastAt === null || context === null); i -= 1) {
    if (!lines[i].trim()) continue;
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (lastAt === null) {
      const at = Date.parse(rec?.timestamp);
      if (Number.isFinite(at)) lastAt = at;
    }
    const usage = rec?.type === "assistant" ? rec?.message?.usage : null;
    if (context === null && usage && typeof usage === "object") {
      context =
        (Number(usage.input_tokens) || 0) +
        (Number(usage.cache_creation_input_tokens) || 0) +
        (Number(usage.cache_read_input_tokens) || 0);
    }
  }
  return { lastAt, context };
}
