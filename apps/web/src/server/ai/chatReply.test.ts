// What an `@assistant` turn posts in the trip chat (M52 decision 18), read off
// the Ask turn's response. The whole thread reads it, so a refusal is a
// sentence, never a bare code, and a stream that failed part-way says so.
import { describe, expect, it, vi } from "vitest";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { ASK_FAILED_MESSAGE, ASK_INTERNAL_ERROR_MESSAGE, STOPPED_EMPTY } from "@tc/contracts";
import { CHAT_ASK_LIMITED, chatReplyOf } from "./handleAskRequest";

const streamed = (chunks: UIMessageChunk[]) =>
  createUIMessageStreamResponse({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  });

/** A stream that sends `chunks` one read at a time, then fails, as a dropped connection does. */
const failingAfter = (chunks: UIMessageChunk[]) => {
  const events = chunks.map((chunk) => new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = events.shift();
        if (next === undefined) controller.error(new Error("connection reset"));
        else controller.enqueue(next);
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

describe("chatReplyOf", () => {
  it("says a coded refusal's own sentence, and an uncoded one by its status", async () => {
    const coded = Response.json({ error: "The assistant is part of Plus.", code: "ai-not-entitled" }, { status: 402 });
    expect((await chatReplyOf(coded)).text).toBe("The assistant is part of Plus.");
    expect((await chatReplyOf(Response.json({ error: "forbidden" }, { status: 403 }))).text).toBe(ASK_FAILED_MESSAGE);
    const broken = Response.json({ error: "rate limiter unavailable", reason: "unavailable" }, { status: 503 });
    expect((await chatReplyOf(broken)).text).toBe(ASK_FAILED_MESSAGE);
    const limited = Response.json({ error: "you've made too many requests — try again later" }, { status: 429 });
    expect((await chatReplyOf(limited)).text).toBe(CHAT_ASK_LIMITED);
    const internal = Response.json({ error: ASK_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    expect((await chatReplyOf(internal)).text).toBe(ASK_INTERNAL_ERROR_MESSAGE);
  });

  it("follows text a failed stream had already said with the failure", async () => {
    const reply = await chatReplyOf(
      streamed([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Day 3 has" },
        { type: "error", errorText: ASK_FAILED_MESSAGE },
      ]),
    );
    expect(reply.text).toBe(`Day 3 has\n\n${ASK_FAILED_MESSAGE}`);
  });

  // The id is what the thread renders the asker's card from; what the
  // resolver could not match is in no stored change, so only the reply says it.
  it("names the suggestion the turn stored, and says what it left out", async () => {
    const suggestionId = "8e1f0b2a-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
    const suggested = { suggestionId, changeCount: 1, snapshotId: null, snapshotName: null, skipped: ["There is no day 9."] };
    const reply = await chatReplyOf(
      streamed([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "It is up for you to review." },
        { type: "finish", messageMetadata: { suggested } },
      ]),
    );
    expect(reply).toEqual({ text: "It is up for you to review.\n\nThere is no day 9.", suggestionId });
  });

  // The hard deadline ends the stream with `abort` and no text of its own;
  // posted as a failure, the thread would be told to try the same thing again.
  it("says a turn stopped at its deadline with nothing said took too long", async () => {
    const reply = await chatReplyOf(streamed([{ type: "start" }, { type: "start-step" }, { type: "abort" }]));
    expect(reply.text).toBe(STOPPED_EMPTY);
  });

  // The suggestion is on the board whatever happens to the stream after it,
  // and the reply is the only way the thread can show the asker its card.
  it("keeps the suggestion it stored when the stream fails after it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const suggestionId = "8e1f0b2a-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
    const suggested = { suggestionId, changeCount: 1, snapshotId: null, snapshotName: null, skipped: [] };
    const reply = await chatReplyOf(
      failingAfter([
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "It is up for you to review." },
        { type: "finish", messageMetadata: { suggested } },
      ]),
    );
    expect(reply).toEqual({ text: `It is up for you to review.\n\n${ASK_FAILED_MESSAGE}`, suggestionId });
  });
});
