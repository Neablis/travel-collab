// **The stage order, asserted by watching the stages run.**
//
// This is the test spec §3 exists for. Three of `ADMISSION`'s transitions are
// recorded incidents, and until P3 all three were defended by comments in a
// 455-line function body — which is to say defended by whoever next moved a
// line remembering to read them:
//
//   * charging the quota BEFORE model selection burned a caller's whole hourly
//     and daily allowance on retries against an outage that produced zero
//     provider calls. The incident outlived its own fix by a day.
//   * a malformed request must not cost the caller their allowance.
//   * a bad page id must cost nothing, which is why the page-scope claim is
//     verified before selection and before the quota.
//
// Each is asserted twice below: once as the declared sequence, and once as the
// consequence — a refusal at one stage means the ports after it were never
// reached. The consequence is the assertion that matters; the sequence is what
// makes a reorder fail with a diff a reader can act on.
//
// It is a UNIT test, which is itself new. The old handler's own comment said
// *"a unit test cannot import this module: `guard()` pulls in next-auth"* —
// true, and measured again here (the unit lane fails to resolve
// `next/server` through next-auth). `AdmissionPorts` is what changes that:
// every effect is injected, so the whole of the admission decision is
// observable without a database, a session or a model.
import { describe, expect, it } from "vitest";
import { tripDetailFactory, tripMemberFactory } from "@tc/factories";
import type { Page, TripDetail, TripRole } from "@tc/contracts";
import type { LanguageModel } from "ai";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";
import type { AskIntentRecord } from "@/server/ai/askAnalytics";
import {
  ADMISSION,
  taskClassFor,
  DEMO_TRIP_UNSUPPORTED_CODE,
  PAGE_NOT_ON_TRIP_CODE,
  evaluateAiGrant,
  type AdmissionPorts,
  type AdmissionStageName,
  type AiGrantRecord,
} from "./admission";
import { NO_CEILINGS, PERMITS_EVERYTHING, type EntitlementCeilings } from "./entitlements";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const EDITOR = "grant-editor";
const VIEWER = "grant-viewer";

const CLASSIFIED_AS_WRITE: AskIntentRecord = {
  taskClass: "edit",
  intent: "write",
  source: "model",
  context: null,
  model: "test/classifier",
  verdict: '{"result":"edit"}',
  failedOpen: false,
  latencyMs: 1,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
};

function detailFor(role: TripRole, userId: string): TripDetail {
  return tripDetailFactory.build(
    { tripId: TRIP_ID, members: [tripMemberFactory.build({ userId, role })] },
    { transient: { dayCount: 3 } },
  );
}

function pageOn(tripId: string): Page {
  return { id: PAGE_ID, tripId, title: "Overview", content: { type: "doc", content: [] } } as unknown as Page;
}

function askFor(body: unknown): Request {
  return new Request("https://example.test/api/trips/t/ask", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TRIP_TURN = {
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "add a museum on day 2" }] }],
  scope: { kind: "trip" },
};

/**
 * Ports that record every call, in order, into `calls`.
 *
 * The recorder IS the assertion: a stage that ran is a port that was reached,
 * and a stage that was skipped is a name absent from the list. Overrides let
 * one port refuse while the rest stay honest.
 */
function spyPorts(overrides: Partial<AdmissionPorts> = {}): {
  ports: AdmissionPorts;
  calls: string[];
  records: AiGrantRecord[];
  admittedCeilings: EntitlementCeilings[];
} {
  const calls: string[] = [];
  const records: AiGrantRecord[] = [];
  const admittedCeilings: EntitlementCeilings[] = [];
  const base: AdmissionPorts = {
    identifyActor: async () => {
      calls.push("identifyActor");
      return { userId: EDITOR, detail: detailFor("editor", EDITOR) };
    },
    loadPage: async () => {
      calls.push("loadPage");
      return pageOn(TRIP_ID);
    },
    selectModel: async () => {
      calls.push("selectModel");
      return {
        outcome: "live",
        // One id per slot, so a test can tell WHICH tier a turn resolved to
        // rather than only that some model came back.
        models: {
          cheap: "test/model-cheap" as LanguageModel,
          mid: "test/model-mid" as LanguageModel,
          strong: "test/model-strong" as LanguageModel,
        },
        classifierModel: "test/classifier" as LanguageModel,
        entitlements: PERMITS_EVERYTHING,
      };
    },
    admitQuota: async (_userId, ceilings) => {
      calls.push("admitQuota");
      // The ceilings this stage was HANDED, kept beside the call list rather
      // than in it: the order test asserts that list exactly, and spec §3b's
      // fourth gap needs the ARGUMENT to be observable, not the name.
      admittedCeilings.push(ceilings);
      return { allowed: true };
    },
    // The real adapter compares against `SIMULATED_MODEL_ID`; nothing injected
    // here is that model, so every turn in this file is a live one.
    isSimulated: () => false,
    classify: async () => {
      calls.push("classify");
      return CLASSIFIED_AS_WRITE;
    },
    audit: (record) => void records.push(record),
  };
  return { ports: { ...base, ...overrides }, calls, records, admittedCeilings };
}

describe("the admission pipeline's ORDER", () => {
  // The sequence itself, as data. It is the one assertion in this file that a
  // reorder fails with a readable diff rather than with a missing side effect,
  // and spec §7d is why it is pinned rather than derived: `selectModel` runs
  // before `admitQuota` because an incident forced it, AND because that is the
  // order M20's per-tier ceilings need — two independent reasons, neither of
  // them visible from the code that reads the result.
  it("declares the nine stages in the order the incidents forced", () => {
    expect(ADMISSION.map((stage) => stage.name)).toEqual([
      "refuseDemoTrip",
      "identifyActor",
      "capRawBody",
      "parseRequest",
      "resolveSurface",
      "selectModel",
      "admitQuota",
      "classifyTask",
      // The ninth, since P4 (spec §3b). It was an epilogue outside the array
      // while still being a name `AiRefusal.stage` could carry, which made it
      // the one refusal this test did not cover. It is LAST because its caps
      // are `min(surface, role, plan, classifier)` and `classifier` is what
      // `classifyTask` — the stage immediately above — produces.
      "grantTools",
    ]);
  });

  // **Every name a refusal may carry is a stage in the array.** The two were
  // allowed to disagree before P4, and the one that disagreed was the only
  // refusal the sequence above could not have caught being moved. Asserted as
  // a set equality rather than a containment so a stage added to the array
  // without a name, or a name added without a stage, both fail here.
  it("has a stage for every name a refusal can carry", () => {
    const names: AdmissionStageName[] = [
      "refuseDemoTrip",
      "identifyActor",
      "capRawBody",
      "parseRequest",
      "resolveSurface",
      "selectModel",
      "admitQuota",
      "classifyTask",
      "grantTools",
    ];
    expect([...ADMISSION.map((stage) => stage.name)].sort()).toEqual([...names].sort());
  });

  // The same claim as a consequence: every port, in the order its stage runs.
  // `loadPage` before `selectModel` before `admitQuota` before `classify` is
  // all three incidents in one line.
  it("reaches each port in that order on a turn that is admitted", async () => {
    const { ports, calls } = spyPorts();
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(true);
    expect(calls).toEqual(["identifyActor", "loadPage", "selectModel", "admitQuota"]);
  });
});

describe("a refusal costs the caller nothing it should not", () => {
  // **The incident this pipeline is shaped around.** A missing
  // AI_GATEWAY_API_KEY made `selectAiModel` throw, and the quota had already
  // been charged — so a caller retrying against an outage that produced zero
  // provider calls burned their whole hourly and daily allowance.
  it("does not charge the quota when model selection fails", async () => {
    const { ports, calls } = spyPorts({
      selectModel: async () => {
        calls.push("selectModel");
        throw new Error("AI_GATEWAY_API_KEY is not set");
      },
    });
    const admission = await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.stage).toBe("selectModel");
    expect(admission.refusal.response.status).toBe(503);
    expect(calls).not.toContain("admitQuota");
    expect(calls).not.toContain("classify");
  });

  it("does not charge the quota, or select a model, for a malformed request", async () => {
    const { ports, calls } = spyPorts();
    const admission = await evaluateAiGrant({ request: askFor("{not json"), tripId: TRIP_ID, ports });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.stage).toBe("parseRequest");
    expect(admission.refusal.response.status).toBe(400);
    expect(calls).toEqual(["identifyActor"]);
  });

  it("does not charge the quota, or select a model, for a page id it cannot resolve", async () => {
    const { ports, calls } = spyPorts({
      loadPage: async () => {
        calls.push("loadPage");
        return null;
      },
    });
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.stage).toBe("resolveSurface");
    expect(admission.refusal.code).toBe(PAGE_NOT_ON_TRIP_CODE);
    expect(calls).toEqual(["identifyActor", "loadPage"]);
  });

  // A page on a DIFFERENT trip is the same 404 as no page at all: `loadPage` is
  // keyed by id alone, so answering them differently confirms the existence of
  // a page on a trip this actor cannot see.
  it("refuses a page that belongs to another trip with the same code", async () => {
    const { ports } = spyPorts({ loadPage: async () => pageOn("99999999-9999-4999-8999-999999999999") });
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.response.status).toBe(404);
    expect(admission.refusal.code).toBe(PAGE_NOT_ON_TRIP_CODE);
  });

  // Before the guard, which is what keeps /ask off the anonymous /demo path
  // (ADR-031, KI-79) — and, since `identifyActor` is where the quota bucket's
  // owner is decided, before anything a visitor could exhaust.
  it("refuses the demo trip before the guard is even asked", async () => {
    const { ports, calls } = spyPorts();
    const admission = await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: DEMO_TRIP_ID, ports });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.stage).toBe("refuseDemoTrip");
    expect(admission.refusal.code).toBe(DEMO_TRIP_UNSUPPORTED_CODE);
    expect(admission.refusal.response.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("the ai.grant record", () => {
  it("names the actor, the granted pairs, the tools offered and the model", async () => {
    const { ports, records } = spyPorts();
    const admission = await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(admission.ok).toBe(true);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.event).toBe("ai.grant");
    expect(record.outcome).toBe("granted");
    expect(record.userId).toBe(EDITOR);
    expect(record.surface).toBe("trip");
    // The (domain, effect) pairs, not a boolean and not a set name.
    expect(record.grants).toEqual({ itinerary: "propose", library: "propose" });
    expect(record.tools).toContain("read_trip");
    expect(record.tools).toContain("AddActivity");
    expect(record.tools).not.toContain("insert_widget");
    // `edit` proposes a tier, the tier resolves to a slot, and the slot is
    // where the model id came from — the record names all three so "which model
    // answered, and why that one" is one line rather than a re-derivation.
    expect(record.taskClass).toBe("edit");
    expect(record.tier).toBe("mid");
    expect(record.model).toBe("test/model-mid");
    expect(record.refusedBy).toBeNull();
  });

  // A viewer's turn is read-only, and the record says so in the same field an
  // editor's does — which is what makes "what is and isn't allowed" one query.
  it("records a viewer's narrower grant, and never classifies their turn", async () => {
    const { ports, calls, records } = spyPorts({
      identifyActor: async () => {
        calls.push("identifyActor");
        return { userId: VIEWER, detail: detailFor("viewer", VIEWER) };
      },
    });
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(records[0]!.grants).toEqual({ itinerary: "read", library: "read" });
    expect(records[0]!.tools).not.toContain("AddActivity");
    // **A viewer's unclassified turn is a `question`, not an absence.** No model
    // was asked — there was no write half to withhold — and a turn holding only
    // read tools is a question whatever it sounds like, so it routes to the
    // cheapest slot rather than to a null nobody can price.
    expect(records[0]!.taskClass).toBe("question");
    expect(records[0]!.tier).toBe("cheap");
    expect(calls).not.toContain("classify");
  });

  // **Which stage refused, and why.** This is the half of the record that
  // replaces tracing thirteen steps, and it is why `AiRefusal` carries a stage
  // name at all rather than only a Response.
  it("names the stage that refused, its code and its status", async () => {
    const { ports, records } = spyPorts({
      // The 429 is the ADAPTER's now (`quotaRefusal`, quota.ts), so the port
      // hands the pipeline the Response it renders rather than a reason the
      // kernel would have to know the status for.
      admitQuota: async () => ({
        allowed: false,
        reason: "user",
        response: Response.json({ error: "too many" }, { status: 429 }),
      }),
    });
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(records).toHaveLength(1);
    expect(records[0]!.outcome).toBe("refused");
    expect(records[0]!.refusedBy).toBe("admitQuota");
    expect(records[0]!.status).toBe(429);
    // The model was already chosen when the quota refused, and the record says
    // so — a refusal after selection and one before it are different events.
    // The MID slot, because a turn refused before `grantTools` has no task
    // class and therefore no tier: `tier` is null and the id names the
    // fallback rather than implying a routing decision that never happened.
    expect(records[0]!.model).toBe("test/model-mid");
    expect(records[0]!.tier).toBeNull();
    expect(records[0]!.tools).toBeNull();
  });

  it("emits exactly one record per turn, granted or refused", async () => {
    const granted = spyPorts();
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports: granted.ports });
    expect(granted.records).toHaveLength(1);

    const refused = spyPorts();
    await evaluateAiGrant({ request: askFor("{"), tripId: TRIP_ID, ports: refused.ports });
    expect(refused.records).toHaveLength(1);
  });
});

describe("the grant a turn holds", () => {
  it("caps the itinerary at read when the classifier read the turn as a question", async () => {
    const { ports } = spyPorts({
      classify: async () => ({ ...CLASSIFIED_AS_WRITE, intent: "question" as const }),
    });
    const admission = await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.grant.grants.itinerary).toBe("read");
    // An EDITOR whose turn was withheld, which is not the same sentence as a
    // viewer's — see `ACCESS_LINE` in handleAskRequest.ts.
    expect(admission.grant.posture).toBe("withheld");
    expect(admission.grant.tools.map((tool) => tool.name)).not.toContain("AddActivity");
  });

  // A page turn reads the trip and writes the page: `itinerary` capped at
  // `read`, `pages` at `propose`, and the two halves therefore disjoint.
  it("grants a page turn the page tools and no planning write tool", async () => {
    const { ports, calls } = spyPorts();
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    const names = admission.grant.tools.map((tool) => tool.name);
    expect(names).toContain("insert_widget");
    expect(names).not.toContain("RemoveActivity");
    expect(admission.grant.page?.id).toBe(PAGE_ID);
    // Its tool set comes from a scope the server verified, so classifying it
    // would be spend with nothing to buy.
    expect(calls).not.toContain("classify");
  });

  it("refuses a viewer's page turn without reaching a model", async () => {
    const { ports, calls } = spyPorts({
      identifyActor: async () => {
        calls.push("identifyActor");
        return { userId: VIEWER, detail: detailFor("viewer", VIEWER) };
      },
    });
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.response.status).toBe(403);
    expect(calls).not.toContain("selectModel");
  });

  it("400s a day scope past the end of the trip, before selecting a model", async () => {
    const { ports, calls } = spyPorts();
    const admission = await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "day", dayIndex: 9 } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.refusal.stage).toBe("resolveSurface");
    expect(admission.refusal.reason).toBe("this trip has 3 days, so day 10 is out of range");
    expect(calls).toEqual(["identifyActor"]);
  });
});

// ---------------------------------------------------------------------------
// Task class, tier, and the ceilings that make the stage order structural (P5)
// ---------------------------------------------------------------------------

describe("what a turn is for, and which slot answers it", () => {
  // The surface decides, and it decides BEFORE the classifier is consulted —
  // which is why a page turn is never classified and never pays for one.
  it("calls a page turn compose without asking a model", async () => {
    const { ports, calls, records } = spyPorts();
    await evaluateAiGrant({
      request: askFor({ ...TRIP_TURN, scope: { kind: "page", pageId: PAGE_ID } }),
      tripId: TRIP_ID,
      ports,
    });

    expect(records[0]!.taskClass).toBe("compose");
    expect(records[0]!.tier).toBe("mid");
    expect(records[0]!.model).toBe("test/model-mid");
    expect(calls).not.toContain("classify");
  });

  // The classifier's verdict, all the way through to a model id. `plan` is the
  // one class that reaches the strong slot, and it is the one whose misrouting
  // §5 says is worth paying for.
  it("routes a turn the classifier called plan to the strong slot", async () => {
    const { ports, records } = spyPorts({
      classify: async () => ({ ...CLASSIFIED_AS_WRITE, taskClass: "plan", verdict: '{"result":"plan"}' }),
    });
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(records[0]!.taskClass).toBe("plan");
    expect(records[0]!.tier).toBe("strong");
    expect(records[0]!.model).toBe("test/model-strong");
  });

  // The two structural answers, pinned directly, because neither is derivable
  // from the classifier's record — which is null in both cases.
  it("decides the unclassified cases structurally", () => {
    expect(taskClassFor(true, null)).toBe("compose");
    expect(taskClassFor(false, null)).toBe("question");
    // A page turn is compose even if something did classify it: the surface's
    // answer is the verified one, and the sentence's is not.
    expect(taskClassFor(true, CLASSIFIED_AS_WRITE)).toBe("compose");
    expect(taskClassFor(false, CLASSIFIED_AS_WRITE)).toBe("edit");
  });
});

describe("admission is handed the ceilings selection resolved", () => {
  // **Spec §3b's fourth gap, closed.** `selectModel` has always run before
  // `admitQuota` — a recorded incident forced it — but until P5 `admitQuota`
  // read nothing `selectModel` produced, so the data dependency that makes
  // every other pair's order structural did not exist for this one. It was held
  // by two test assertions and nothing else. This asserts the ARGUMENT, not the
  // order: the order test above cannot tell a coincidence from a dependency.
  it("passes the resolved ceilings into the quota stage", async () => {
    const { ports, admittedCeilings } = spyPorts();
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(admittedCeilings).toEqual([NO_CEILINGS]);
  });

  // And the ceilings are the ones the resolver named, not a default the adapter
  // reached for — a settlement metered against different numbers than the
  // admission charge is a silent mis-charge on exactly the accounts M20 bills.
  it("passes whatever the resolver named, unaltered", async () => {
    const ceilings = { perUserRequestsPerDay: 7, perUserStepsPerDay: 70, maxTier: "cheap" as const };
    const { ports, admittedCeilings, records } = spyPorts({
      selectModel: async () => ({
        outcome: "live",
        models: {
          cheap: "test/model-cheap" as LanguageModel,
          mid: "test/model-mid" as LanguageModel,
          strong: "test/model-strong" as LanguageModel,
        },
        classifierModel: "test/classifier" as LanguageModel,
        entitlements: { has: () => true, ceilings, planVersionRef: "plus@v1" },
      }),
    });
    await evaluateAiGrant({ request: askFor(TRIP_TURN), tripId: TRIP_ID, ports });

    expect(admittedCeilings).toEqual([ceilings]);
    // And the same resolution caps the tier: `edit` proposes `mid`, the plan
    // permits at most `cheap`, and `cheap` is what the turn gets.
    expect(records[0]!.taskClass).toBe("edit");
    expect(records[0]!.tier).toBe("cheap");
    expect(records[0]!.model).toBe("test/model-cheap");
  });
});
