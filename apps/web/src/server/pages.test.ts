import { describe, expect, it, vi } from "vitest";
import { CreatePageInput, PageDoc, serializePageDoc } from "@tc/contracts";
import { readBody } from "./readBody";
import { MAX_PAGE_BODY_BYTES, checkPageDocForWrite } from "./pages";

// `pages.ts` imports the pool for its reads; this file only calls the pure
// write check, so nothing here may reach a database.
vi.mock("./db/client", () => ({ db: {} }));

// KI-2026-10-18-b: `@tiptap/core` 2.x's `mergeAttributes()` turns an OWN
// `__proto__` key into inherited DOM attributes (GHSA-cp6q-959q-f8rh). The
// entry's first question: can a stored notebook carry such a key past the
// server? This walks the real write path, wire to stored bytes: the BFF route's
// `readBody(CreatePageInput)`, `serializePageDoc`, the command's re-parse,
// `checkPageDocForWrite`, `serializePageDoc` again, and the jsonb round trip.
// `JSON.parse` is what makes `__proto__` an own key, as a request body does.

const PROTO = '{"onclick":"alert(1)"}';
const para = (inline: string) => `{"type":"paragraph","content":[${inline}]}`;

async function store(content: string): Promise<{ refused: string } | { stored: unknown }> {
  const body = `{"title":"t","context":{"tripId":"00000000-0000-4000-8000-000000000001"},"content":{"type":"doc","content":[${content}]}}`;
  const request = new Request("http://localhost/api/trips/t/pages", { method: "POST", body });
  const read = await readBody(request, CreatePageInput, "invalid-page", { maxBytes: MAX_PAGE_BODY_BYTES });
  if ("error" in read) return { refused: `readBody ${read.error.status}` };
  const commandDoc = PageDoc.safeParse(serializePageDoc(read.data.content));
  if (!commandDoc.success) return { refused: "command parse" };
  const checked = checkPageDocForWrite(commandDoc.data);
  if (!checked.ok) return { refused: checked.message };
  return { stored: JSON.parse(JSON.stringify(serializePageDoc(checked.doc))) };
}

function ownProtoPaths(value: unknown, path = "$"): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value).flatMap((key) => [
    ...(key === "__proto__" ? [path] : []),
    ...ownProtoPaths((value as Record<string, unknown>)[key], `${path}.${key}`),
  ]);
}

describe("an own __proto__ key on the notebook write path (KI-2026-10-18-b)", () => {
  it("stores the same documents without the key, so a refusal below is about the key", async () => {
    for (const content of [
      `{"type":"heading","attrs":{"level":1},"content":[]}`,
      para(`{"type":"text","text":"x","marks":[{"type":"bold"}]}`),
      `{"type":"macro","attrs":{"name":"attribute","params":{"field":"trip.name"}}}`,
    ]) {
      expect(await store(content), content).toHaveProperty("stored");
    }
  });

  it("is refused on every strict position the editor mounts", async () => {
    for (const content of [
      `{"type":"paragraph","__proto__":${PROTO},"content":[]}`,
      `{"type":"heading","attrs":{"level":1,"__proto__":${PROTO}},"content":[]}`,
      para(`{"type":"text","text":"x","marks":[{"type":"bold","__proto__":${PROTO}}]}`),
      `{"type":"macro","attrs":{"name":"attribute","params":{"field":"trip.name"},"__proto__":${PROTO}}}`,
    ]) {
      expect(await store(content), content).toEqual({ refused: "readBody 400" });
    }
  });

  it("does not survive into the stored document from an open record", async () => {
    // Mark attrs and widget params are `z.record`, which assigns each key onto
    // a fresh object: `__proto__` there sets that object's prototype instead
    // of making a key, and serialising drops it.
    for (const content of [
      para(`{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"https://a.example","__proto__":${PROTO}}}]}`),
      `{"type":"macro","attrs":{"name":"attribute","params":{"field":"trip.name","__proto__":${PROTO}}}}`,
    ]) {
      const result = await store(content);
      expect(result, content).toHaveProperty("stored");
      expect(ownProtoPaths((result as { stored: unknown }).stored), content).toEqual([]);
    }
  });

  it("survives only inside a node this build does not know, which is never given to the editor as attributes", async () => {
    // ADR-038 decision 3 keeps such a node byte-identical. Read back, it is
    // wrapped as `{ type: "unknown", raw }`: there is no `attrs` for TipTap to
    // read, and `inspectStoredPageDoc` opens the page read-only.
    const result = await store(`{"type":"future","attrs":{"__proto__":${PROTO}}}`);
    expect(ownProtoPaths((result as { stored: unknown }).stored)).toEqual(["$.content.0.attrs"]);
    const [node] = PageDoc.parse((result as { stored: unknown }).stored).content;
    expect(node?.type).toBe("unknown");
    expect(node && "attrs" in node).toBe(false);
  });
});
