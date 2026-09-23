// **An invite token opens exactly the reads the demo opens, and no write**
// (M27 D12).
//
// `requireTripAccess`'s `inviteToken` is opt-in per call, which makes it safe
// to forget — and unsafe to add in the wrong place. The int suite proves the
// seam refuses a write rank (`trip-access.int.test.ts`); this proves the other
// half, which no runtime test can see without enumerating every route: WHERE
// the token is passed. Each exported handler in `src/app/api` is read on its
// own, and the two opt-ins must travel together, in `GET`s only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test-support/stripComments";

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app/api");

function routeFiles(dir = API): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** Each `export async function VERB(` and the source up to the next one. */
function handlers(file: string): { route: string; verb: string; body: string }[] {
  const source = stripComments(readFileSync(file, "utf8"));
  const starts = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)];
  return starts.map((match, index) => ({
    route: path.relative(API, file),
    verb: match[1]!,
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

const all = routeFiles().flatMap(handlers);
const takesToken = all.filter((h) => h.body.includes("inviteTokenOf("));

describe("where an invite token is accepted", () => {
  it("is accepted only by GET handlers", () => {
    expect(takesToken.filter((h) => h.verb !== "GET")).toEqual([]);
  });

  it("is accepted by exactly the handlers that serve the demo trip, and they are all reads", () => {
    const servesDemo = all.filter((h) => h.body.includes("allowDemo: true"));
    expect(takesToken.map((h) => `${h.verb} ${h.route}`).sort()).toEqual(
      servesDemo.map((h) => `${h.verb} ${h.route}`).sort(),
    );
    // Witness: the eight reads M27 D12 names. Without a floor, a regex that
    // matched no handler at all would pass both assertions above over nothing.
    expect(takesToken).toHaveLength(8);
  });
});
