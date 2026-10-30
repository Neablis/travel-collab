// **ADR-084 §4: every surface's instruction says what it can change and where
// the rest is done**, generated from `SURFACES` and the registry. Beside
// `surfaceVoice.test.ts` for that file's reason: each surface builds its own
// instruction, so a block added to one reaches the others only if checked.
import { describe, expect, it } from "vitest";
import { accountInstructionBlocks, instructionsFor, playbookInstructionBlocks } from "@/server/ai/handleAskRequest";
import { CHANGE_IN, capabilitiesOf, capabilityBlock, changeDomains } from "@/server/assistant/capabilities";
import { SURFACES, type SurfaceKind } from "@/server/assistant/grants";
import { renderPrompt } from "@/server/assistant/prompt";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";

const INSTRUCTION: Readonly<Record<SurfaceKind, (upgradable: boolean) => string>> = {
  trip: (upgradable) => instructionsFor({ kind: "trip" }, 3, "propose", null, false, undefined, "12h", [], [], upgradable),
  day: (upgradable) => instructionsFor({ kind: "day", dayIndex: 0 }, 3, "propose", null, false, undefined, "12h", [], [], upgradable),
  page: (upgradable) =>
    instructionsFor({ kind: "page", pageId: PAGE_ID }, 3, "propose", { title: "Food" }, false, undefined, "12h", [], [], upgradable),
  account: (upgradable) => renderPrompt(accountInstructionBlocks({ kind: "account" }, "12h", upgradable)),
  "playbook-day": (upgradable) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "playbook-day", "12h", upgradable)),
  playbook: (upgradable) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "playbook", "12h", upgradable)),
  discover: (upgradable) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "discover", "12h", upgradable)),
  city: (upgradable) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "city", "12h", upgradable)),
  tag: (upgradable) => renderPrompt(playbookInstructionBlocks({ kind: "account" }, "tag", "12h", upgradable)),
};

const SURFACE_KINDS = Object.keys(SURFACES) as SurfaceKind[];

describe("the capability block", () => {
  it.each(SURFACE_KINDS.flatMap((surface) => [[surface, false] as const, [surface, true] as const]))(
    "reaches the instruction on %s (upgradable: %s)",
    (surface, upgradable) => {
      const lines = INSTRUCTION[surface](upgradable).split("\n");
      for (const line of renderPrompt(capabilityBlock(surface, upgradable)).split("\n")) expect(lines, surface).toContain(line);
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
      expect(capabilitiesOf(surface, true).targets, surface).toContain("upgrade");
      expect(capabilitiesOf(surface).targets, surface).toContain("nowhere");
    }
  });

  it("replaces Home's refusal line", () => {
    expect(INSTRUCTION.account(false)).not.toContain("changes are made inside a trip");
  });
});
