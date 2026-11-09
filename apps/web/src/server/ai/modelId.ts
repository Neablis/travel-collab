// Pure id resolution for the two provider-direct model families (M59 part 4).
// No client and no key here, so it sits outside ADR-019's chokepoint: `gateway.ts`
// builds the Anthropic client, `embeddings.ts` the OpenAI one, and the eval
// harness may resolve an id without importing either.

/**
 * Drop the whitespace and the literal two-character `\n` a pasted secret leaves
 * on an env value (observed on a production value, 2026-11-08).
 */
function cleanId(raw: string): string {
  return raw.trim().replace(/(\\n|\s)+$/, "");
}

function splitId(id: string): { provider: string; model: string } {
  const slash = id.indexOf("/");
  if (slash <= 0) return { provider: "", model: "" };
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

/**
 * The Anthropic model name for a chat id in Gateway form
 * (`anthropic/claude-haiku-5.5`), refusing every other provider: the env keeps
 * its form so no setting changes, but only Anthropic is wired.
 *
 * @returns `id` is the cleaned Gateway-form id, which the ledger and rate table
 *   key on; `model` is the bare name the provider takes.
 */
export function resolveChatModel(rawId: string): { provider: "anthropic"; model: string; id: string } {
  const id = cleanId(rawId);
  const { provider, model } = splitId(id);
  if (provider !== "anthropic" || model === "") {
    throw new Error(`Unsupported chat model "${id}": only anthropic/<model> ids are served`);
  }
  return { provider, model, id };
}

/**
 * The OpenAI embedding model name for `openai/text-embedding-3-small`, refusing
 * any other provider. The vectors already in Upstash Vector were made by this
 * model, so a different one would mean a re-index.
 */
export function resolveEmbeddingModel(rawId: string): { provider: "openai"; model: string } {
  const id = cleanId(rawId);
  const { provider, model } = splitId(id);
  if (provider !== "openai" || model === "") {
    throw new Error(`Unsupported embedding model "${id}": only openai/<model> ids are served`);
  }
  return { provider, model };
}
