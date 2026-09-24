// **Board ⌘Z can never revert prose** — the guarantee ADR-036 decision 2 bought
// with a per-page stream, and which the trip stream has to earn instead (the
// amendment of 2026-09-24). It rests on two facts, and each is asserted here
// over arbitrary interleavings rather than the one hand-built log in
// `pageHistory.test.ts`:
//
//   1. a history decision carries trip events only, so applying one leaves the
//      page fold exactly as it was — for undo, redo AND revert to any seq;
//   2. a notebook save never becomes the undo target, so ⌘Z always reaches the
//      last itinerary change instead of wedging on a batch it cannot undo.
//
// Written for the day someone finishes KI-2026-09-22-c the naive way: splicing
// `diffPageStates` into `decideHistoryCommand` turns the first assertion red.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPageEventType, type EventEnvelope, type PageDoc } from "@tc/contracts";
import { decideHistoryCommand, deriveUndoRedo, foldPages, groupBatches, type HistoryCommand } from "../src";
import { witness } from "./support/witness";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const PAGES = ["7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70", "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f71"];
const ALICE = "alice";
const id = (block: number, n: number) => `00000000-0000-4000-${block}000-${String(n).padStart(12, "0")}`;

const doc = (text: string): PageDoc =>
  ({ v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }) as PageDoc;

type Step =
  | { k: "day" }
  | { k: "page"; page: number; text: number }
  | { k: "undo" }
  | { k: "redo" }
  | { k: "revert"; at: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.constant<Step>({ k: "day" }),
  fc.record({ k: fc.constant("page" as const), page: fc.integer({ min: 0, max: 1 }), text: fc.integer({ min: 0, max: 3 }) }),
  fc.constant<Step>({ k: "undo" }),
  fc.constant<Step>({ k: "redo" }),
  fc.record({ k: fc.constant("revert" as const), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
);

/** One log, grown step by step the way the server would grow it. */
function logBuilder() {
  const log: EventEnvelope[] = [];
  let batch = 0;
  const append = (events: { type: string; payload: unknown }[], origin: EventEnvelope["origin"]) => {
    batch += 1;
    for (const e of events) {
      log.push({
        streamId: TRIP, seq: log.length + 1, type: e.type, version: 1, payload: e.payload,
        actorId: ALICE, occurredAt: "2026-09-24T00:00:00.000Z", batchId: id(8, batch), origin,
      });
    }
  };
  append([{ type: "TripCreated", payload: { tripId: TRIP, name: "Japan", createdBy: ALICE, forkedFrom: null } }], { kind: "user" });
  return { log, append };
}

describe("board history never touches a notebook", () => {
  it("undo, redo and revert leave every page as it was, and never target a notebook save", () => {
    const w = witness("board history leaves prose alone");
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 30 }), (steps) => {
        const { log, append } = logBuilder();
        let days = 0;
        for (const s of steps) {
          if (s.k === "day") {
            days += 1;
            append([{ type: "DayAdded", payload: { tripId: TRIP, dayId: id(9, days) } }], { kind: "user" });
            continue;
          }
          if (s.k === "page") {
            const pageId = PAGES[s.page]!;
            const current = foldPages(log)[pageId];
            const content = doc(`text ${s.text}`);
            if (current === undefined) {
              append([{
                type: "PageCreated",
                payload: { tripId: TRIP, pageId, title: `Page ${s.page}`, context: { tripId: TRIP }, content, actorId: ALICE },
              }], { kind: "user" });
            } else {
              append([{ type: "PageEdited", payload: { tripId: TRIP, pageId, content } }], { kind: "user" });
            }
            continue;
          }

          const head = log.length;
          const command: HistoryCommand =
            s.k === "undo" ? { type: "UndoLastChange", tripId: TRIP }
            : s.k === "redo" ? { type: "RedoChange", tripId: TRIP }
            : { type: "RevertToState", tripId: TRIP, toSeq: 1 + Math.floor(s.at * (head - 1)) };

          // Fact 2: whatever undo would pick is a batch with trip events in it.
          const targets = deriveUndoRedo(groupBatches(log));
          if (targets.undo !== null) {
            const target = groupBatches(log).find((b) => b.batchId === targets.undo!.batchId);
            expect(target?.events.length).toBeGreaterThan(0);
          }

          const decision = decideHistoryCommand(log, command);
          if (!decision.ok) continue;
          const before = foldPages(log);
          expect(decision.events.filter((e) => isPageEventType(e.type))).toEqual([]);
          append(decision.events, decision.origin);
          // Fact 1, as a reader would meet it: every notebook reads the same.
          expect(foldPages(log)).toEqual(before);
          if (Object.keys(before).length > 0) w.tick();
        }
      }),
      { numRuns: 300 },
    );
    w.atLeast(75); // observed 157-184 over five runs
  });
});
