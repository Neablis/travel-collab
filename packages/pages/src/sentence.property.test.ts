// The sentence grammar's claims for EVERY input (`sentenceTemplate.ts` in
// `@tc/contracts`; tested here, where the witness lives and where a line is
// printed):
//
// 1. Parsing never throws, and parse → serialize → parse is the same parse:
//    serializing is the canonical spelling of what a string means.
// 2. Parts written by serialize come back as the same parts.
// 3. A line prints a value exactly once, as its characters: whatever a stop is
//    called, `A{title}B` prints `A`, the name, `B` — never a re-read of it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSentenceTemplate, serializeSentenceTemplate, type SentencePart } from "@tc/contracts";
import type { WidgetContext } from "./registry-types";
import { sentenceLine } from "./sentence";
import { selectionTrip } from "./test-support/selectionTrip";
import { witness } from "./test-support/witness";

const RUNS = 300;

// Brace-heavy strings, because braces are the whole grammar: an arbitrary
// string almost never holds `{name}`, so a plain `fc.string()` would test the
// text path and little else.
const braceyString = fc
  .array(fc.oneof(fc.constantFrom("{", "}", "{{", "}}", "{name}", "{title}", "{ x }", "{}", "$"), fc.string({ maxLength: 4 })), {
    maxLength: 20,
  })
  .map((pieces) => pieces.join(""));

const keyArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/);
const partsArb: fc.Arbitrary<SentencePart[]> = fc.array(
  fc.oneof(
    fc.string({ minLength: 1, maxLength: 8 }).map((text): SentencePart => ({ text })),
    keyArb.map((field): SentencePart => ({ field })),
  ),
  { maxLength: 10 },
);

// What the parser promises its output looks like: adjacent text merged, none empty.
function normalized(parts: readonly SentencePart[]): SentencePart[] {
  const out: SentencePart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if ("text" in part && last !== undefined && "text" in last) out[out.length - 1] = { text: last.text + part.text };
    else out.push(part);
  }
  return out;
}

describe("the sentence grammar, for every string", () => {
  it("never throws, and serialize is a canonical spelling of the parse", () => {
    const w = witness("parse/serialize canonical");
    fc.assert(
      fc.property(fc.oneof(braceyString, fc.string({ maxLength: 40 })), (template) => {
        const parts = parseSentenceTemplate(template);
        const spelled = serializeSentenceTemplate(parts);
        expect(parseSentenceTemplate(spelled)).toEqual(parts);
        // A canonical spelling is a fixed point.
        expect(serializeSentenceTemplate(parseSentenceTemplate(spelled))).toBe(spelled);
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // No guard clause: every run asserts, so the floor is exact.
    w.atLeast(RUNS);
  });

  it("gives back the parts serialize was handed", () => {
    const w = witness("parts round trip");
    fc.assert(
      fc.property(partsArb, (parts) => {
        expect(parseSentenceTemplate(serializeSentenceTemplate(parts))).toEqual(normalized(parts));
        w.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(RUNS);
  });
});

describe("a printed line, for every stop name", () => {
  const { trip, globals, ids } = selectionTrip();
  const ctx: WidgetContext = { trip, globals, page: { tripId: trip.tripId }, user: null, today: null };
  const item = { kind: "stop" as const, activityId: ids.s0, dayIndex: 0 };

  it("prints the text around a token as written, and the value once, as its characters", () => {
    const w = witness("value printed once");
    fc.assert(
      fc.property(
        fc.string({ maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        fc.oneof(braceyString, fc.string({ minLength: 1, maxLength: 60 })).filter((s) => s !== ""),
        (before, after, title) => {
          const named: WidgetContext = {
            ...ctx,
            trip: { ...trip, activities: { ...trip.activities, [ids.s0]: { ...trip.activities[ids.s0]!, title } } },
          };
          const template = serializeSentenceTemplate([{ text: before }, { field: "title" }, { text: after }]);
          expect(sentenceLine(named, "stop", item, parseSentenceTemplate(template))).toBe(before + title + after);
          w.tick();
        },
      ),
      { numRuns: RUNS },
    );
    // The filter drops the empty name, which reads as "no value" rather than as
    // a name; fast-check draws again rather than skipping, so every run still
    // asserts (measured: 300 of 300, ten runs out of ten).
    w.atLeast(RUNS);
  });
});
