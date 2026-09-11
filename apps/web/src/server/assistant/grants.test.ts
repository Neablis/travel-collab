// The surface table and the four caps (ADR-043 decision 2).
//
// **This file is where the three tool sets are pinned by NAME**, and it is the
// one place they are. `offeredToolNamesFor`'s test asserted a switch against the
// three constants the switch returned, which is F-F02: two statements of one
// fact, each proving the other. The sets below are asserted against literal
// names and against `@tc/contracts` — never against the table that produces
// them — so a wrong row fails here rather than agreeing with itself.
import { describe, expect, it } from "vitest";
import { BatchableCommand } from "@tc/contracts";
import { ASSISTANT_TOOLS } from "./registry";
import {
  SURFACES,
  grantFor,
  minimumRoleFor,
  permitsPropose,
  postureFor,
  toolsFor,
  type EffectCaps,
} from "./grants";

const READ_TOOLS = ["read_trip", "read_day", "find_free_time", "search_playbooks"];
const COMMAND_TOOLS = BatchableCommand.options.map((option) => option.shape.type.value as string);
const PAGE_TOOLS = ["insert_text", "insert_widget"];

function namesFor(caps: EffectCaps): string[] {
  return toolsFor(grantFor(caps)).map((tool) => tool.name);
}

/** An editor, on a plan that permits everything, whose turn was read as a write. */
const EDITOR: Omit<EffectCaps, "surface"> = { role: "propose", plan: "propose", classifier: "propose" };

describe("the three tool sets a turn can be offered", () => {
  // Today's `READ_TOOL_NAMES`. Every domain capped at `read`, whichever surface
  // asks — which is what makes a viewer's trip turn and an editor's withheld
  // turn the same set without either being a special case.
  it("is the four read tools when every cap is `read`", () => {
    expect(namesFor({ surface: "trip", role: "read", plan: "read", classifier: "read" })).toEqual(READ_TOOLS);
  });

  // Today's `READ_TOOL_NAMES + WRITE_TOOL_NAMES`. The command half is derived
  // from the contract rather than listed, so a thirteenth `BatchableCommand`
  // joins the set — and `minimumRoleFor`'s editor answer — with no edit here
  // (ADR-015 invariant 5).
  it("is the read tools plus every command plus insert_playbook_day on a trip or day surface", () => {
    const expected = [...READ_TOOLS, ...COMMAND_TOOLS, "insert_playbook_day"];
    expect(namesFor({ ...EDITOR, surface: "trip" })).toEqual(expected);
    expect(namesFor({ ...EDITOR, surface: "day" })).toEqual(expected);
  });

  // Today's `READ_TOOL_NAMES + PAGE_TOOL_NAMES`, and ADR-033 Decision 4's
  // narrowing: the `itinerary` domain is capped at `read` here, so no planning
  // write tool is reachable, and no other surface names `pages` at all.
  it("is the read tools plus the two page tools on a page surface", () => {
    expect(namesFor({ ...EDITOR, surface: "page" })).toEqual([...READ_TOOLS, ...PAGE_TOOLS]);
  });

  it("keeps the page and planning halves disjoint in both directions", () => {
    const page = namesFor({ ...EDITOR, surface: "page" });
    const planning = namesFor({ ...EDITOR, surface: "trip" });
    for (const name of [...COMMAND_TOOLS, "insert_playbook_day"]) expect(page).not.toContain(name);
    for (const name of PAGE_TOOLS) expect(planning).not.toContain(name);
  });

  // A page turn still browses the library, which is the `library: read` row.
  // Drop that row and `search_playbooks` disappears from a surface that has it
  // today — the narrowing ADR-033 Decision 4 wants is on `itinerary`, not on
  // the corpus.
  it("still offers search_playbooks on a page turn, because the page surface grants library at read", () => {
    expect(SURFACES.page).toContainEqual({ domain: "library", max: "read" });
    expect(namesFor({ ...EDITOR, surface: "page" })).toContain("search_playbooks");
  });

  // **The domain tags, pinned on their own, because nothing else can pin them.**
  // The spec says tagging `search_playbooks` `itinerary` "would silently drop it
  // from the page surface". It would not: `itinerary` and `library` carry the
  // SAME cap on all three rows of today's table (`read`/`read`/`propose` against
  // `read`/`read`/`propose` — the page row caps both at `read`), so retagging
  // either library tool changes no tool set at all. Measured: flipping
  // `search_playbooks` to `itinerary` left all seventeen assertions in this file
  // green.
  //
  // The tag is still right and still worth having — it is the audit answer to
  // "what is this tool about", it is what a fourth surface (`city`, `timeline`)
  // would grant one of without the other, and it is ADR-042 Decision 2's
  // capability boundary written down. But a tag no behaviour depends on is a
  // comment with a timer on it unless something asserts it, so this is that
  // something.
  it("tags each tool with the domain the surface table is written against", () => {
    const domainOf = (name: string) => ASSISTANT_TOOLS.find((tool) => tool.name === name)?.domain;
    expect(domainOf("read_trip")).toBe("itinerary");
    expect(domainOf("read_day")).toBe("itinerary");
    expect(domainOf("find_free_time")).toBe("itinerary");
    expect(domainOf("search_playbooks")).toBe("library");
    expect(domainOf("insert_playbook_day")).toBe("library");
    expect(domainOf("insert_text")).toBe("pages");
    expect(domainOf("insert_widget")).toBe("pages");
    for (const name of COMMAND_TOOLS) expect(domainOf(name), name).toBe("itinerary");
  });

  // "Offered" is a measurement the analytics record reads, so the ORDER has to
  // be the registry's rather than the filter's own.
  it("returns tools in registry order, whatever the grant", () => {
    for (const surface of ["trip", "day", "page"] as const) {
      const selected = toolsFor(grantFor({ ...EDITOR, surface }));
      const positions = selected.map((tool) => ASSISTANT_TOOLS.indexOf(tool));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe("a grant is a minimum over four independent caps", () => {
  // Each cap alone narrows the whole turn to reads. Four assertions rather than
  // one because the failure they catch is a term being dropped from the `min`,
  // and a single case cannot tell which term is missing.
  it.each([
    ["role", { role: "read" }],
    ["plan", { plan: "read" }],
    ["classifier", { classifier: "read" }],
  ] as const)("narrows a trip turn to the read tools when %s says read", (_label, override) => {
    expect(namesFor({ ...EDITOR, surface: "trip", ...override })).toEqual(READ_TOOLS);
  });

  // The fourth cap, and the one that is not a scalar: the page surface caps
  // `itinerary` at `read` while granting `pages` at `propose`, which is the
  // asymmetry a single effect could not express.
  it("lets the surface cap one domain while granting another", () => {
    const grant = grantFor({ ...EDITOR, surface: "page" });
    expect(grant.itinerary).toBe("read");
    expect(grant.pages).toBe("propose");
  });

  // Silence denies. No tool declares `places`, `account` or `system` today, and
  // one that did would be offered nowhere until a surface row named its domain.
  it("grants no domain a surface does not name", () => {
    for (const surface of ["trip", "day", "page"] as const) {
      const named = new Set(SURFACES[surface].map((pair) => pair.domain as string));
      const grant = grantFor({ ...EDITOR, surface });
      expect(Object.keys(grant).sort()).toEqual([...named].sort());
      expect(grant.places).toBeUndefined();
    }
  });

  // The term M20 owns. It has no source yet and must not have invented one:
  // today it permits everybody, which is what makes P2 a refactor.
  it("permits propose for everybody until M20 supplies a plan", () => {
    expect(permitsPropose({ userId: "anyone" })).toBe("propose");
  });
});

describe("minimumRoleFor", () => {
  it("answers viewer for a read-only turn and editor as soon as one write tool is in", () => {
    const readOnly = toolsFor(grantFor({ surface: "trip", role: "read", plan: "read", classifier: "read" }));
    expect(minimumRoleFor(readOnly)).toBe("viewer");
    // One at a time, so the answer is the MAXIMUM over the set rather than a
    // membership test against a read-only name list — which is what it used to
    // be, and what its own comment always said it wanted not to be.
    const writes = ASSISTANT_TOOLS.filter((tool) => tool.effect === "propose");
    expect(writes).not.toHaveLength(0);
    for (const tool of writes) {
      expect(minimumRoleFor([...readOnly, tool]), `${tool.name} must require editor`).toBe("editor");
    }
  });

  it("answers viewer for an empty set — a turn with no tools requires nothing", () => {
    expect(minimumRoleFor([])).toBe("viewer");
  });
});

describe("the posture is derived, not passed in", () => {
  const caps = (role: "read" | "propose", plan: "read" | "propose", classifier: "read" | "propose") =>
    ({ role, plan, classifier }) as const;

  it("distinguishes an editor whose turn was withheld from a viewer who cannot edit", () => {
    expect(postureFor(caps("propose", "propose", "propose"))).toBe("propose");
    // The distinction ACCESS_LINE's three sentences exist for: role and plan
    // both permit `propose` and the classifier did not, so the turn is
    // retryable and the model must say so rather than claim it cannot edit.
    expect(postureFor(caps("propose", "propose", "read"))).toBe("withheld");
    expect(postureFor(caps("read", "propose", "read"))).toBe("read-only");
  });

  it("does not tell a viewer their turn is retryable, whatever the classifier said", () => {
    expect(postureFor(caps("read", "propose", "propose"))).toBe("read-only");
  });

  // Unreachable today (`permitsPropose`), and asserted so that M20 inherits the
  // rule rather than deciding it again: rephrasing does not recover a plan cap,
  // so `withheld`'s "ask again saying what you want changed" would be the dead
  // end that copy exists to avoid.
  it("reads a plan that does not permit propose as read-only, not withheld", () => {
    expect(postureFor(caps("propose", "read", "propose"))).toBe("read-only");
  });
});
