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
import { TASK_CLASSES } from "./taskClass";

const READ_TOOLS = ["read_trip", "read_day", "find_free_time", "search_playbooks"];
// **In registry order, which puts it after the read tools and before the
// commands** — `search_places` has to be read before the tools whose `placeRef`
// cites it (registry.ts). Its own list rather than a fifth entry in
// `READ_TOOLS`, because the two differ on the page surface: the reads are
// offered there and this is not.
const PLACE_TOOLS = ["search_places"];
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
  it("is the four read tools plus search_places when every cap is `read`", () => {
    // **`search_places` survives every `read` cap, and that is correct rather
    // than an oversight.** It IS a read — it reads a public gazetteer and
    // writes nothing — so a viewer may search and an editor whose turn was read
    // as a question may too. What neither can do is CITE the result, because
    // neither holds a write tool; the grant arithmetic already says so, and a
    // second rule here would be a second place to keep it true.
    expect(namesFor({ surface: "trip", role: "read", plan: "read", classifier: "read" })).toEqual([
      ...READ_TOOLS,
      ...PLACE_TOOLS,
    ]);
  });

  // Today's `READ_TOOL_NAMES + WRITE_TOOL_NAMES`. The command half is derived
  // from the contract rather than listed, so a thirteenth `BatchableCommand`
  // joins the set — and `minimumRoleFor`'s editor answer — with no edit here
  // (ADR-015 invariant 5).
  it("is the read tools plus every command plus insert_playbook_day on a trip or day surface", () => {
    const expected = [...READ_TOOLS, ...PLACE_TOOLS, ...COMMAND_TOOLS, "insert_playbook_day"];
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
    expect(domainOf("search_places")).toBe("places");
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
    expect(namesFor({ ...EDITOR, surface: "trip", ...override })).toEqual([...READ_TOOLS, ...PLACE_TOOLS]);
  });

  // The fourth cap, and the one that is not a scalar: the page surface caps
  // `itinerary` at `read` while granting `pages` at `propose`, which is the
  // asymmetry a single effect could not express.
  it("lets the surface cap one domain while granting another", () => {
    const grant = grantFor({ ...EDITOR, surface: "page" });
    expect(grant.itinerary).toBe("read");
    expect(grant.pages).toBe("propose");
  });

  // Silence denies. No tool declares `account` today, and one that did would be
  // offered nowhere until a surface row named its domain.
  //
  // **`places` was on that list until M9's grounding, and adding the tool was
  // not enough** — `search_places` existed, was in the registry, carried every
  // tag, and was offered on no surface at all until `SURFACES` named its
  // domain. That is the table working. The assertion below keeps measuring the
  // table rather than a list of expected domains, so the next domain to arrive
  // gets the same treatment without an edit here.
  it("grants no domain a surface does not name", () => {
    for (const surface of ["trip", "day", "page"] as const) {
      const named = new Set(SURFACES[surface].map((pair) => pair.domain as string));
      const grant = grantFor({ ...EDITOR, surface });
      expect(Object.keys(grant).sort()).toEqual([...named].sort());
      expect(grant.account).toBeUndefined();
    }
  });

  // **A page turn holds no tool that can spend the vendor key**, which is the
  // one row of the table that is a decision rather than the absence of a tool.
  // The reason is SCOPE: a page turn writes a document out of what the trip
  // already contains, so the gazetteer is not a source it draws on. Being
  // unable to CITE is not the disqualifier — a viewer on a trip turn cannot
  // cite either, and is offered the search, because asking about the world
  // around the trip is what that surface is for.
  it("offers no place search on a page surface, on any cap", () => {
    for (const caps of [EDITOR, { role: "read", plan: "read", classifier: "read" } as const]) {
      expect(namesFor({ ...caps, surface: "page" })).not.toContain("search_places");
    }
    expect(SURFACES.page.map((pair) => pair.domain as string)).not.toContain("places");
  });

  // **The only tool that declares `spend: "vendor"`, and the set is a filter
  // over the registry rather than a list somebody maintains.**
  //
  // P5 recorded the tag and nothing read it, for the reason M9's milestone file
  // gives: the real LocationIQ door was `commitProposal`'s geocoder on the
  // apply path, which is not a tool at all. Grounding made the tag true of
  // something. A second spending tool is a decision, and this assertion is
  // where it gets noticed.
  it("has exactly one tool that can spend at a vendor", () => {
    expect(ASSISTANT_TOOLS.filter((tool) => tool.spend === "vendor").map((tool) => tool.name)).toEqual([
      "search_places",
    ]);
  });

  // **An unsure verdict must not narrow the tool set** (CodeRabbit, PR #184).
  //
  // `intentOf` resolves `question | unsure` to write intent, so the turn holds
  // the change tools — and the CLASS stays `question`, because keeping what the
  // classifier actually said is the whole point of the band. Narrowing by that
  // class would let the class axis take back what the effect axis granted.
  //
  // Asserted on `toolsFor` directly rather than through admission, because the
  // rule belongs to the filter: a tool tagged for `edit`/`plan` only — none
  // exists today, which is why this was latent — would be removed from a turn
  // that was handed the write tools on purpose.
  it("narrowing by a class never removes a tool the ungoverned grant allowed", () => {
    const editorTrip: EffectCaps = { surface: "trip", role: "propose", plan: "propose", classifier: "propose" };
    const unnarrowed = toolsFor(grantFor(editorTrip), undefined, "propose").map((t) => t.name);
    for (const taskClass of TASK_CLASSES) {
      const narrowed = toolsFor(grantFor(editorTrip), taskClass, "propose").map((t) => t.name);
      expect(unnarrowed, taskClass).toEqual(expect.arrayContaining(narrowed));
    }
    // And `question` in particular takes nothing away TODAY, which is what
    // makes the admission-side fix latent rather than live — recorded so the
    // next person to add a `taskClasses` entry can see what they are changing.
    expect(toolsFor(grantFor(editorTrip), "question", "propose").map((t) => t.name)).toEqual(unnarrowed);
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

// The third filter axis (`defineTool`'s `taskClasses`), added 2026-09-12 after a
// live planning turn was offered all seventeen tools, read four of them, and
// proposed nothing. `domain` and `effect` cannot express this: every planning
// command is `itinerary`/`propose` because they are derived from one union.
describe("a task class narrows the tool set, and only ever subtracts", () => {
  // Three, not four. `SetTripName` was the fourth until M9's KI-12: *"the AI
  // cannot leave a trip half-planned"* is a gate box, and a planning turn that
  // cannot name the trip it just planned is the headline flow failing to finish
  // the job it advertises. `TASK_CLASSES_FOR`'s own comment predicted both the
  // dead end and the remedy — one deleted entry — and this is it.
  const WITHHELD_FROM_PLAN = ["SetTripCurrency", "SetTripBudget", "DismissConflict"];
  const editorTrip: EffectCaps = { ...EDITOR, surface: "trip" };
  const unnarrowed = toolsFor(grantFor(editorTrip)).map((t) => t.name);

  it("does not narrow when no class is passed — a caller that has not classified gets everything", () => {
    expect(unnarrowed).toEqual(expect.arrayContaining([...READ_TOOLS, ...COMMAND_TOOLS]));
    expect(toolsFor(grantFor(editorTrip), undefined).map((t) => t.name)).toEqual(unnarrowed);
  });

  it("withholds the three trip-settings commands from a plan turn and keeps the rest", () => {
    const planning = toolsFor(grantFor(editorTrip), "plan").map((t) => t.name);
    for (const name of WITHHELD_FROM_PLAN) expect(planning).not.toContain(name);
    // The ones a plan genuinely needs, including BOTH date commands — "plan me
    // six days from March 3" is a planning turn that has to set dates — and,
    // since KI-12, `SetTripName`, so "plan me a trip" can produce a complete
    // one. Being OFFERED the tool is not being told to use it: the instruction
    // that does that is conditioned on the trip being empty
    // (`handleAskRequest.ts`'s `TripStanding`), which is what keeps the
    // assistant from renaming a trip somebody already named.
    for (const name of ["AddDay", "AddActivity", "SetTripDates", "SetTripStartDate", "SetTripName", "insert_playbook_day"]) {
      expect(planning).toContain(name);
    }
    expect(planning).toEqual(expect.arrayContaining(READ_TOOLS));
    expect(planning).toHaveLength(unnarrowed.length - WITHHELD_FROM_PLAN.length);
  });

  it("offers an edit turn everything, because a bounded change can be any command", () => {
    expect(toolsFor(grantFor(editorTrip), "edit").map((t) => t.name)).toEqual(unnarrowed);
  });

  // The invariant that matters more than any single policy entry: a tag may
  // only ever take a tool away. A `taskClasses` entry that somehow ADDED one
  // would route around the grant — the thing `toolsFor` exists to enforce.
  it("never yields a tool the ungoverned grant did not already allow", () => {
    for (const taskClass of TASK_CLASSES) {
      const narrowed = toolsFor(grantFor(editorTrip), taskClass).map((t) => t.name);
      expect(unnarrowed).toEqual(expect.arrayContaining(narrowed));
    }
  });
});

// **Escalation never widens access — asserted as a PROPERTY, not a scenario**
// (M9 design §9).
//
// The design says why in one line: *"Escalation exists only in `withheld`, and
// `withheld` is by definition where role and plan both permit `propose`. Assert
// `postureFor` never yields the tool outside it and the claim holds for cases
// nobody enumerated."* Three scenario tests over three postures would prove
// three things; this proves the rule.
describe("the escalation tool is reachable in exactly one posture", () => {
  const EFFECTS = ["read", "propose"] as const;
  const SURFACES_UNDER_TEST = ["trip", "day", "page"] as const;

  /** Every combination of the four caps — 24 of them, enumerated rather than sampled. */
  function everyCaps(): EffectCaps[] {
    const all: EffectCaps[] = [];
    for (const surface of SURFACES_UNDER_TEST) {
      for (const role of EFFECTS) {
        for (const plan of EFFECTS) {
          for (const classifier of EFFECTS) all.push({ surface, role, plan, classifier });
        }
      }
    }
    return all;
  }

  it("is offered when and only when the posture is withheld", () => {
    for (const caps of everyCaps()) {
      const offered = toolsFor(grantFor(caps), undefined, postureFor(caps)).map((tool) => tool.name);
      const holdsIt = offered.includes("request_change_tools");
      // A page turn is the one case where the posture can be `withheld` and the
      // tool still absent, and it is absent for a different reason: the page
      // surface grants no `system` domain at all. Both filters have to agree
      // before a tool is offered, so the property is "offered implies
      // withheld", plus "withheld on a planning surface implies offered".
      if (holdsIt) expect(postureFor(caps), JSON.stringify(caps)).toBe("withheld");
      if (postureFor(caps) === "withheld" && caps.surface !== "page") {
        expect(holdsIt, JSON.stringify(caps)).toBe(true);
      }
    }
  });

  // The consequence that matters, said as the thing a reader is worried about:
  // a viewer, or an account whose plan does not permit `propose`, can never
  // reach it. Both resolve to `read-only`, where rephrasing would recover
  // nothing — and neither would escalating.
  it("is never offered to anyone who could not already propose", () => {
    for (const caps of everyCaps()) {
      if (caps.role === "propose" && caps.plan === "propose") continue;
      expect(toolsFor(grantFor(caps), undefined, postureFor(caps)).map((t) => t.name)).not.toContain(
        "request_change_tools",
      );
    }
  });

  // **An absent posture ARGUMENT does not offer it**, which is the opposite of
  // how the task-class axis treats an absent argument — and deliberately so. A
  // caller who has not classified the turn must not be handed a NARROWED set
  // (fail-closed); a caller who does not know the posture must not be handed a
  // tool whose one condition they cannot have checked (fail-closed again). Same
  // direction, opposite default, because the tags mean different things.
  it("is not offered to a caller that did not say which posture it is", () => {
    const editorTrip: EffectCaps = { surface: "trip", role: "propose", plan: "propose", classifier: "read" };
    expect(postureFor(editorTrip)).toBe("withheld");
    expect(toolsFor(grantFor(editorTrip)).map((t) => t.name)).not.toContain("request_change_tools");
    expect(toolsFor(grantFor(editorTrip), undefined, "withheld").map((t) => t.name)).toContain(
      "request_change_tools",
    );
  });

  // The escalated set is the same grant with ONE cap lifted, so it is bounded
  // by exactly what the actor may do. This is the arithmetic `admission.ts`
  // performs, asserted here where the arithmetic lives.
  it("unlocks no more than the same actor would have held on a change turn", () => {
    const withheld: EffectCaps = { surface: "trip", role: "propose", plan: "propose", classifier: "read" };
    // The escalated set, computed the way `admission.ts` computes it: the same
    // caps with ONE lifted — the classifier's, which is the cap the model has
    // just said was wrong.
    const lifted: EffectCaps = { ...withheld, classifier: "propose" };
    const escalated = toolsFor(grantFor(lifted), "edit", postureFor(lifted)).map((t) => t.name);

    // The CEILING it must not exceed, computed independently of the escalation
    // path: everything this actor's role and plan permit on this surface, with
    // no class narrowing at all.
    const everythingTheActorMayDo = toolsFor(grantFor(lifted), undefined, postureFor(lifted)).map((t) => t.name);
    expect(everythingTheActorMayDo).toEqual(expect.arrayContaining(escalated));

    // And it is strictly wider than the turn was holding — an escalation that
    // unlocked nothing would be a charged step for no reason.
    const beforeEscalating = toolsFor(grantFor(withheld), "question", postureFor(withheld)).map((t) => t.name);
    expect(escalated.length).toBeGreaterThan(beforeEscalating.length);
    for (const name of ["AddActivity", "SetTripDates"]) expect(escalated).toContain(name);

    // The escalation tool itself is gone from it: once the turn has the change
    // tools there is nothing left to escalate to, and offering it would let a
    // turn spend a second charged step saying so.
    expect(escalated).not.toContain("request_change_tools");
    expect(beforeEscalating).toContain("request_change_tools");

    // `minimumRoleFor` over the wider set still answers `editor`, which is what
    // `admission.ts` checks the actor against before admitting the turn at all.
    expect(minimumRoleFor(toolsFor(grantFor(lifted), "edit", postureFor(lifted)))).toBe("editor");
  });
});
