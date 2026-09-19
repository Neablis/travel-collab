import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESIGN_PATH,
  NOT_DRAWN,
  README_PATH,
  ROUTES,
  SPEC_PATH,
  appRoutes,
  buildRows,
  gateLine,
  render,
} from "../route-artboard-index.mjs";

// KI-2026-09-14-c, gap 1. There was no path from a route to the part of the
// design that draws it, so finding the operator console meant guessing a
// heading and grepping an 844 KB file. The index is the fix; these tests are
// what keep it from becoming a confidently-wrong map, which is worse than no
// map because it is believed.

test("the checked-in index is current", () => {
  const text = readFileSync(README_PATH, "utf8");
  assert.equal(
    render(text),
    text,
    "the route→artboard index is stale — run `node scripts/route-artboard-index.mjs --write`",
  );
});

// The claim every row makes, checked against the design file itself: follow the
// line and land on that screen's gate. The design side rewrites this file in
// place each pass, so these numbers move whenever they touch it.
test("every row's line number lands on that screen's `<sc-if>` gate", () => {
  const design = readFileSync(DESIGN_PATH, "utf8").split("\n");
  const rows = [...readFileSync(README_PATH, "utf8").matchAll(/^\| `(.+?)` \| `(\w+)` · line (\d+) \|/gm)];
  assert.ok(rows.length > 0, "expected drawn rows in the index");
  for (const [, route, gate, line] of rows) {
    const text = design[Number(line) - 1];
    assert.ok(text !== undefined, `${route} points at line ${line}, past the end of the design file`);
    assert.ok(
      text.includes(`<sc-if value="{{ ${gate} }}"`),
      `${route} points at line ${line}, which is not \`${gate}\`: ${text?.slice(0, 90)}`,
    );
  }
});

// The red proof (CLAUDE.md rule 3): the design side renaming a gate is the
// single most likely way this index rots, so the generator must refuse rather
// than emit a row pointing nowhere.
test("a gate the design file no longer has is refused, not silently emitted", () => {
  const design = readFileSync(DESIGN_PATH, "utf8");
  assert.equal(gateLine(design, "isNoSuchGateAnywhere"), null);
  assert.throws(
    () => buildRows([{ route: "/x", gate: "isNoSuchGateAnywhere", spec: [1], note: "" }], design),
    /no longer in the design file/,
  );
  // And the shape that must still work, so the guard is not passing by refusing
  // everything.
  assert.doesNotThrow(() => buildRows(ROUTES, design));
});

// The forcing function, and the reason this is a test and not a hand-written
// table: adding a route without deciding what draws it now fails here instead
// of being rediscovered by the next person to build that screen.
test("every route in the app is either mapped to an artboard or explicitly not drawn", () => {
  const mapped = new Set(ROUTES.map((r) => r.route));
  const undecided = appRoutes().filter((route) => !mapped.has(route) && !NOT_DRAWN.has(route));
  assert.deepEqual(
    undecided,
    [],
    `these routes have no artboard decision — add them to ROUTES or NOT_DRAWN in scripts/route-artboard-index.mjs: ${undecided.join(", ")}`,
  );
});

// Non-vacuity for the escape hatch, the same argument the colour wall's Sentry
// exclusion gets: an exemption for a route that no longer exists is dead weight
// that makes the list look more principled than it is.
test("every NOT_DRAWN exemption is a route that still exists", () => {
  const routes = new Set(appRoutes());
  for (const [route, reason] of NOT_DRAWN) {
    assert.ok(routes.has(route), `${route} is exempted (${reason}) but no longer exists — delete the exemption`);
  }
});

// A `/account` row that cites §34 is worth nothing if §34 is not in SPEC.md.
// The section index test asserts SPEC's own headings; this asserts that what
// the route table sends a reader to actually lands somewhere.
test("every spec section cited by a row exists in SPEC.md", () => {
  const spec = readFileSync(SPEC_PATH, "utf8");
  const headings = new Set(
    [...spec.matchAll(/^##\s+§?(\d+)\s*(?:\.|—|-|:)/gm)].map((m) => Number(m[1])),
  );
  for (const entry of ROUTES) {
    for (const section of entry.spec) {
      assert.ok(headings.has(section), `${entry.route} cites §${section}, which SPEC.md does not have`);
    }
  }
});

// `/account` is in the table and not in the app: the design is ahead, and M26
// link 1 is what closes it. Stated as a test so the row is understood as a
// known gap rather than read as a bug in route discovery.
test("a mapped route the build has not shipped yet is allowed, and /account is the one", () => {
  const built = new Set(appRoutes());
  const unbuilt = ROUTES.filter((r) => !built.has(r.route)).map((r) => r.route);
  assert.deepEqual(unbuilt, ["/account"]);
  assert.match(ROUTES.find((r) => r.route === "/account").note, /NOT BUILT YET/);
});
