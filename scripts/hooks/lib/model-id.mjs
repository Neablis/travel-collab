// A hyphenated Claude model id: `claude-<family>-<digit>` or the older
// `claude-<digit>-...` shape. The required co-author trailer names the model in
// words ("Claude Opus 5.5"), with no hyphens, so it never matches; neither does
// `claude-code`, which has no digit after its second hyphen.
export const MODEL_ID = /\bclaude-(?:[a-z]+-)?\d[\w.-]*/i;

/** The first model id in `text`, or null. */
export function findModelId(text) {
  const m = MODEL_ID.exec(String(text ?? ""));
  return m ? m[0] : null;
}
