// **ADR-084 §4: every surface's instruction says what it can change and where
// the rest is done**, generated from `SURFACES` and the registry. Beside
// `surfaceVoice.test.ts` for that file's reason: each surface builds its own
// instruction, so a block added to one reaches the others only if checked.
import { describe, expect, it } from "vitest";
import { accountInstructionBlocks, instructionsFor, playbookInstructionBlocks } from "@/server/ai/handleAskRequest";
import { CHANGE_IN, capabilitiesOf, capabilityBlock, changeDomains, type ChangeLimit } from "@/server/assistant/capabilities";
import { SURFACES, grantFor, postureFor, toolsFor, type SurfaceKind } from "@/server/assistant/grants";
import { renderPrompt } from "@/server/assistant/prompt";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";

const INSTRUCTION: Readonly<Record<SurfaceKind, (limit: ChangeLimit) => string>> = {
  trip: (limit) => instructionsFor({ kind: "trip" }, 3, "propose", null, false, undefined, "12h", [], [], limit),
  day: (limit) => instructionsFor({ kind: "day", dayIndex: 0 }, 3, "propose", null, false, undefined, "12h", [], [], limit),
  page: (limit) => instructionsFor({ kind: "page", pageId: PAGE_ID }, 3, "propose", { title: "Food" }, false, undefined, "12h", [], [], limit),
  account: (limit) => renderPrompt(accountInstructionBlocks({ kind: "account" }, "12h", limit)),
  "playbook-day": (limit) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "playbook-day", "12h", limit)),
  playbook: (limit) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "playbook", "12h", limit)),
  discover: (limit) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "discover", "12h", limit)),
  city: (limit) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "city", "12h", limit)),
  tag: (limit) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "tag", "12h", limit)),
};

const SURFACE_KINDS = Object.keys(SURFACES) as SurfaceKind[];

describe("the capability block", () => {
  it.each(SURFACE_KINDS.flatMap((surface) => [[surface, null] as const, [surface, "plan"] as const, [surface, "role"] as const]))(
    "reaches the instruction on %s (limit: %s)",
    (surface, limit) => {
      const lines = INSTRUCTION[surface](limit).split("\n");
      // A page brief with no intent is a compose turn, so its block is that class's.
      const block = capabilityBlock(surface, limit, surface === "page" ? "compose" : undefined);
      for (const line of renderPrompt(block).split("\n")) expect(lines, surface).toContain(line);
    },
  );

  it("names a target for every change a surface cannot make, and a description for every change domain", () => {
    for (const domain of changeDomains()) expect(CHANGE_IN[domain], domain).not.toBeNull();
    for (const surface of SURFACE_KINDS) {
      const { changes, elsewhere } = capabilitiesOf(surface);
      for (const entry of elsewhere) expect(entry.to.length, `${surface}: ${entry.domain}`).toBeGreaterThan(0);
      // Every change domain is either made here or routed somewhere, except a
      // playbook where a trip's own library change already takes one in.
      expect(changes.length + elsewhere.length, surface).toBeGreaterThanOrEqual(changeDomains().length - 1);
    }
  });

  it("follows the surface table: Home sends a trip change to a trip or to New trip, and a notebook to the plan", () => {
    expect(capabilitiesOf("account").changes).toEqual([]);
    expect(capabilitiesOf("account").elsewhere.find((entry) => entry.domain === "itinerary")?.to).toEqual(["plan_page", "new_trip"]);
    expect(capabilitiesOf("page").elsewhere.find((entry) => entry.domain === "itinerary")?.to).toEqual(["plan_page"]);
    expect(capabilitiesOf("trip").elsewhere.map((entry) => entry.domain)).toEqual(["pages"]);
  });

  it("offers upgrade only to a turn whose plan holds no changes", () => {
    for (const surface of SURFACE_KINDS) {
      expect(capabilitiesOf(surface).targets, surface).not.toContain("upgrade");
      expect(capabilitiesOf(surface, "plan").targets, surface).toContain("upgrade");
      expect(capabilitiesOf(surface, "role").targets, surface).not.toContain("upgrade");
      expect(capabilitiesOf(surface).targets, surface).toContain("nowhere");
    }
  });

  // M56 part 5 review: a viewer's trip turn was told *"From this page you can
  // change the trip's plan"* beside *"You can READ this trip and nothing
  // else"*, and to hand off a change no page lets them make.
  it("tells a viewer, and a plan without changes, that this turn changes nothing", () => {
    for (const surface of ["trip", "day", "page"] as const) {
      for (const limit of ["role", "plan"] as const) {
        const { changes, elsewhere, targets } = capabilitiesOf(surface, limit);
        expect({ changes, elsewhere }, `${surface}, ${limit}`).toEqual({ changes: [], elsewhere: [] });
        expect(targets, `${surface}, ${limit}`).toEqual(limit === "role" ? ["new_trip", "nowhere"] : ["new_trip", "upgrade", "nowhere"]);
      }
    }
    // A read-only trip turn naming no cause is told the role's narrower line.
    const viewer = instructionsFor({ kind: "trip" }, 3, "read-only");
    expect(viewer).toContain("From this page you can change nothing.");
    expect(viewer).not.toContain("you can change the trip's plan");
    expect(viewer).toContain("Their role on this trip lets them read it, not change it");
    expect(viewer).not.toContain('"upgrade"');
  });

  // M56 part 5 review: a notebook compose turn was told to call `show_options`,
  // which that class's set never holds (no search feeds it there), so the call
  // came back as a grant refusal and a wasted step.
  it("names show_options only to a page turn whose class is offered it", () => {
    const caps = { surface: "page", role: "propose", plan: "propose", classifier: "propose" } as const;
    const told = (intent: "compose" | "question") =>
      instructionsFor({ kind: "page", pageId: PAGE_ID }, 3, "propose", { title: "Food", intent }).includes("show_options");
    const offered = (intent: "compose" | "question") => toolsFor(grantFor(caps), intent, postureFor(caps)).some((tool) => tool.name === "show_options");
    expect([told("compose"), told("question")]).toEqual([offered("compose"), offered("question")]);
    expect([told("compose"), told("question")]).toEqual([false, true]);
  });

  it("replaces Home's refusal line", () => {
    expect(INSTRUCTION.account(null)).not.toContain("changes are made inside a trip");
  });
});
