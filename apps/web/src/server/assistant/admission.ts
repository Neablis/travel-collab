// **Who may spend the operator's money on this turn, and on what** — the /ask
// admission pipeline (ADR-043 decision 3, spec §3).
//
// Thirteen steps used to run inline at the top of `handleAskRequest`, and the
// three properties that mattered about them were all properties of their
// ORDER, defended by three comments. They are now a declared array (`ADMISSION`
// below), each comment moved onto the stage it describes, and the order is
// asserted by a test that watches the stages actually run (admission.test.ts).
// Reordering them is a red test rather than a code review someone has to
// notice.
//
// **One verdict, one record.** `evaluateAiGrant` returns either the grant a
// turn holds or the refusal it got, and emits exactly one `ai.grant` line
// naming the actor, the granted (domain, effect) pairs, the tools actually
// offered, the model chosen and — on a refusal — WHICH STAGE refused and why.
// That record is the answer to "what is and isn't allowed": one function to
// read and one log line to query, instead of thirteen steps to trace.
//
// **It lives INSIDE the kernel, and that is the test of whether the ports are
// real** (spec §3b, decided for P4). P3 built it in `src/server/ai` and flagged
// the contradiction rather than resolving it silently: the import wall denies
// all five things it needs. The resolution is the one the requirement forces —
// the service should *"know how to pull in context, evaluate context"*, and
// `ai.grant` is the answer to "what is and isn't allowed", so a pipeline
// outside the wall would put the entire audit surface outside the wall with it
// and leave the one part of the assistant a service extraction cannot take.
// What moving it cost was three port signatures re-spelled in the kernel's own
// vocabulary (`ModelChoice`, `QuotaVerdict`, `isSimulated` below) — which is
// what a port layer is, rather than a workaround for the wall.
//
// **Everything with an effect arrives as a port** (`AdmissionPorts`, bound in
// `server/ai/admissionPorts.ts`). Two of them have to: `guard()` reaches
// next-auth and `getPage` reaches Postgres, and a module that imports either
// cannot be loaded by the unit lane at all — which is why the whole of this
// file's logic was previously reachable only through the integration suite (the old
// handler said so: *"a unit test cannot import this module: `guard()` pulls in
// next-auth"*). The other three are ports for the same reason the two are: a
// stage's job is to decide, and a test that can watch every decision in order
// is the point of the array.
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Page, TripDetail, TripRole } from "@tc/contracts";
import { isDemoTripId } from "@/lib/demoTrip";
import { hasAtLeast } from "@/server/accessPolicy";
import type { AskScope } from "@/server/ai/context";
import type { AskIntentRecord } from "@/server/ai/askAnalytics";
import { MAX_ASK_BODY_BYTES, MAX_ASK_MESSAGES, MAX_PROMPT_CHARS } from "@/server/ai/limits";
import type { AnyAssistantTool, ToolEffect } from "./defineTool";
import { PERMITS_EVERYTHING, type EntitlementCeilings, type ResolvedEntitlements } from "./entitlements";
import { capTier, tierFor, type ModelTier, type TaskClass, type TierModels } from "./taskClass";
import {
  grantFor,
  minimumRoleFor,
  permitsPropose,
  postureFor,
  toolsFor,
  type AskToolPosture,
  type GrantedEffects,
  type SurfaceKind,
} from "./grants";

// The refusal code for the demo trip. Kebab-case and named after the reason,
// matching `ai-not-entitled` (modelSelection.ts) — a client can branch on it
// without matching prose.
export const DEMO_TRIP_UNSUPPORTED_CODE = "demo-trip-unsupported";

// The refusal code for a page scope the server could not resolve to a page on
// THIS trip. Same reasoning as above, and it exists because "that page is not
// on this trip" is a refusal a legitimate client can reach by racing a delete.
export const PAGE_NOT_ON_TRIP_CODE = "page-not-on-trip";

// The minimum to get through the door: the role the NARROWEST turn there is
// still requires. A viewer's turn is read-only and always was; whether THIS turn
// also gets a write half is decided by `grantTools` below, from the role the
// guard resolved and the scope the server verified, not from the route.
//
// Every cap at `read` is what "narrowest" means — `grantFor` is a minimum, so
// the surface it is asked about cannot widen the answer.
export const ASK_MINIMUM_ROLE = minimumRoleFor(
  toolsFor(grantFor({ surface: "trip", role: "read", plan: "read", classifier: "read" })),
);

// The minimum an approval needs — the same computation, asked about the widest
// set a proposal can have come from.
export const APPLY_MINIMUM_ROLE = minimumRoleFor(
  toolsFor(grantFor({ surface: "trip", role: "propose", plan: "propose", classifier: "propose" })),
);

// Only the fields this pipeline enforces caps on. The authoritative validation
// is `validateUIMessages` inside `createAgentUIStreamResponse`, which knows the
// full UIMessage part union including tool parts; duplicating it here would be
// a hand-written copy of someone else's schema. What this does is turn the
// three ceilings into a 400 that NAMES the rule broken, before a model is
// selected and before the caller is charged.
const AskUiMessage = z.object({
  id: z.string().min(1),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.object({ type: z.string() }).passthrough()),
});

const AskScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trip") }),
  z.object({ kind: z.literal("day"), dayIndex: z.number().int().min(0) }),
  // Shape only. `pageId` is a CLAIM `resolveSurface` VERIFIES below — this
  // schema says it could be a page id, not that it is one. `uuid()` rather than
  // a bare string because `pages.id` is a uuid column: a malformed id would
  // otherwise reach Postgres as a query it cannot run.
  z.object({ kind: z.literal("page"), pageId: z.string().uuid() }),
]);

export const AskRequest = z.object({
  messages: z
    .array(AskUiMessage)
    .min(1, "messages must not be empty")
    .max(MAX_ASK_MESSAGES, `a thread may hold at most ${MAX_ASK_MESSAGES} messages`),
  scope: AskScopeSchema,
});

export type AskUiMessage = z.infer<typeof AskUiMessage>;

/** Every text part of a message, concatenated — what the cap is measured against. */
export function textOf(message: AskUiMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => (part as unknown as { text: string }).text)
    .join("");
}

/**
 * The messages the classifier is shown besides the latest one, oldest first.
 *
 * Two, which in a normal thread is the previous question and the answer to
 * it — enough for "Yes go ahead" to resolve to what was offered. They are
 * truncated by `askIntentPrompt`, not here: how much of a message a model
 * needs is that module's decision, and this one's job is only to say which
 * messages.
 */
function recentContext(messages: readonly AskUiMessage[]): { role: "user" | "assistant"; text: string }[] {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  return messages
    .slice(0, Math.max(lastUserIndex, 0))
    .filter((message) => message.role !== "system")
    .slice(-2)
    .map((message) => ({ role: message.role as "user" | "assistant", text: textOf(message) }))
    .filter((message) => message.text.trim().length > 0);
}

export function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

// ---------------------------------------------------------------------------
// The body ritual, read once and shared (F-F03)
// ---------------------------------------------------------------------------

/** A body read that failed, as the sentence the 400 has to name. */
type BodyProblem = { ok: false; error: string };

/**
 * The raw body, capped on BYTES before it is parsed.
 *
 * A 10 MB thread must be refused without ever being deserialized, and
 * `request.json()` would deserialize it first. `Blob` counts bytes, not UTF-16
 * code units, which is what a limit named in KB has to mean.
 *
 * Shared by both halves of /ask, which is the whole of F-F03: the ask handler
 * and the apply handler each carried this verbatim, and a cap enforced in two
 * places is a cap that will eventually be enforced in one.
 */
export async function capRawBody(request: Request): Promise<{ ok: true; raw: string } | BodyProblem> {
  const raw = await request.text().catch(() => null);
  if (raw === null) return { ok: false, error: "could not read the request body" };
  if (new Blob([raw]).size > MAX_ASK_BODY_BYTES) {
    return { ok: false, error: `the request body must be ${MAX_ASK_BODY_BYTES} bytes or fewer` };
  }
  return { ok: true, raw };
}

/**
 * JSON, then the schema — and the 400 NAMES the rule broken.
 *
 * The caps are the rejections a legitimate caller can hit by accident (a
 * pasted document, a long thread), so the response says which rule broke
 * rather than returning a generic envelope.
 */
export function parseRequest<Schema extends z.ZodTypeAny>(
  raw: string,
  schema: Schema,
): { ok: true; value: z.infer<Schema> } | BodyProblem {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "malformed request" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "malformed request" };
  return { ok: true, value: parsed.data as z.infer<Schema> };
}

// ---------------------------------------------------------------------------
// The pipeline's vocabulary
// ---------------------------------------------------------------------------

/**
 * Every stage that can refuse, and the value `AiRefusal.stage` carries.
 *
 * **`grantTools` is the NINTH stage, not an epilogue** (spec §3b, landed in
 * P4). P3 left it outside `ADMISSION` while still requiring every refusal to
 * name a stage, which made it the one refusal whose name was not in the array
 * the order test reads. It refuses — the `minimumRoleFor` backstop 403 — and a
 * step that can refuse is a stage. It runs LAST because the caps it resolves
 * are `min(surface, role, plan, classifier)` and `classifier` comes from
 * `classifyTask`, the last of the other eight.
 */
export type AdmissionStageName =
  | "refuseDemoTrip"
  | "identifyActor"
  | "capRawBody"
  | "parseRequest"
  | "resolveSurface"
  | "selectModel"
  | "admitQuota"
  | "classifyTask"
  | "grantTools";

/**
 * A refusal, as both a machine fact and the Response that goes out.
 *
 * `code` is null for the plain 400s, which have never carried one; the three
 * that do (`demo-trip-unsupported`, `page-not-on-trip`, `ai-not-entitled`) keep
 * the exact strings a deployed client already branches on.
 */
export interface AiRefusal {
  stage: AdmissionStageName;
  code: string | null;
  /** Why, in the words the caller is given. */
  reason: string;
  response: Response;
}

/**
 * What one admitted turn holds.
 *
 * Spec §3 calls this `AiGrant` and so does this file, and it is now the only
 * `AiGrant` there is: P3 found `grants.ts` had taken the name for the
 * (domain → effect) map, which is this type's `grants` field, and P4 renamed
 * that map `GrantedEffects`. The verdict kept the name because it is what the
 * `ai.grant` audit record is a record *of*.
 */
export interface AiGrant {
  tripId: string;
  userId: string;
  detail: TripDetail;
  /** What the user is looking at — `scope.kind`, VERIFIED, never claimed. */
  surface: SurfaceKind;
  scope: AskScope;
  /** The page row `resolveSurface` verified, or null on any other surface. */
  page: Page | null;
  /** The (domain, maxEffect) pairs this turn holds. */
  grants: GrantedEffects;
  /** The definitions actually offered — a measurement, not a manifest. */
  tools: readonly AnyAssistantTool[];
  /** What the instruction may honestly claim about this turn (grants.ts). */
  posture: AskToolPosture;
  /**
   * **Whether the task-class filter removed a tool the grant would otherwise
   * have offered** — measured by comparing the two sets, never inferred from
   * the class.
   *
   * It exists because `posture` cannot express a PARTIAL write set. `propose`
   * tells the model to emit every change the request needs; `withheld` tells it
   * there is no change tool at all. A `plan` turn is neither: it can propose
   * most things and has no `SetTripName`. Handed `propose` alone, a model asked
   * to *"plan six days in Tokyo and call it Spring Trip"* has no tool for the
   * rename and no instruction to mention that — so it drops it silently, which
   * is the dead end `ACCESS_LINE`'s own comment says is not priced in.
   */
  classWithheld: boolean;
  /** The model the turn's TIER resolved to — see `tier`. */
  model: LanguageModel;
  classifierModel: LanguageModel;
  modelId: string;
  simulated: boolean;
  /**
   * The model slot this turn ran on: `tierFor(taskClass)`, capped by whatever
   * the account's plan permits (spec §7e — task class proposes, entitlement
   * caps). Recorded on the `ai.grant` line so "which model answered, and why
   * that one" is one record rather than a re-derivation.
   */
  tier: ModelTier;
  /**
   * What the account may do and what it was sold, resolved once at
   * `selectModel` and carried rather than re-queried. M20 requires this be
   * resolved per request from the database — *"a downgrade must bite before a
   * token refreshes"* — so asking twice in one turn would be two answers to one
   * question. `admitQuota` reads `ceilings` from here, and the handler reads
   * `planVersionRef` for the ledger.
   */
  entitlements: ResolvedEntitlements;
  /**
   * The classifier's whole record, which the per-ask analytics record carries
   * so a misclassification is diagnosable after the fact. Null when the turn
   * was not classified at all (a viewer, or a page turn).
   */
  classification: AskIntentRecord | null;
  /**
   * **What this turn is FOR**, and therefore which tier answers it (spec §5).
   *
   * Never null, which is the change P5 made: `question | write | null` became a
   * total answer, because every turn has a purpose even when no model was asked
   * what it was. A page turn is `compose` **by construction** — its tool set
   * comes from a scope the server verified, so classifying it would be spend
   * with nothing to buy — and an unclassified non-page turn is a viewer's,
   * which has no write half to withhold and is therefore a `question`.
   *
   * `classification` beside it still says whether a model was asked, and what
   * it answered.
   */
  taskClass: TaskClass;
  messages: AskUiMessage[];
  /** The latest user message, verbatim — what the caps were measured against. */
  question: string;
  turn: "opening" | "follow-up";
}

export type AiAdmission = { ok: true; grant: AiGrant } | { ok: false; refusal: AiRefusal };

/**
 * Everything a stage does that is not a decision.
 *
 * Each is the whole of one stage's reach, for the same reason a tool's `needs`
 * is the whole of its reach (ADR-043 decision 1): a stage that could get at
 * anything else would make the audit record below a claim rather than a
 * measurement. `admissionPorts.ts` binds them to the real edges.
 */
export interface AdmissionPorts {
  /** `guard()` — the session, the membership check and the trip detail. */
  identifyActor(
    tripId: string,
    minimum: TripRole,
  ): Promise<{ error: Response } | { userId: string; detail: TripDetail }>;
  /** The page store, keyed by id ALONE — see `resolveSurface`. */
  loadPage(pageId: string): Promise<Page | null>;
  /** `selectAiModel()` — the entitlement check and the `ai-live` kill switch. */
  selectModel(userId: string): Promise<ModelChoice>;
  /**
   * `consumeQuota([...aiQuotas(), ...aiStepQuotas()])` — requests AND steps.
   *
   * **`ceilings` is what closes spec §3b's fourth gap.** `selectModel` runs
   * before this stage because an incident forced it, but until P5 `admitQuota`
   * read nothing `selectModel` produced — so the data dependency that makes
   * every other pair's order structural did not exist for this one, and the
   * ordering was held by two test assertions and nothing else. Passing the
   * resolved ceilings makes it structural: this stage cannot run before the one
   * that resolves its argument.
   *
   * Per M20 link 5, the bucket `name` must NOT vary with these numbers — a
   * tier-suffixed bucket would zero an account's usage on upgrade and let
   * anyone farm free calls by toggling. Only the numbers move; `quota.ts`
   * enforces it and a property test pins it.
   */
  admitQuota(userId: string, ceilings: EntitlementCeilings): Promise<QuotaVerdict>;
  /**
   * Is this model id the simulated one? `simulatedModel.ts` owns that identity
   * and is the far side of the wall, so the kernel asks rather than compares
   * against a copied constant — the copy is how the badge and the model drift
   * apart. Only the injected-model branch of `selectModel` needs it; the real
   * path is answered by `ModelChoice.outcome`.
   */
  isSimulated(modelId: string): boolean;
  /**
   * `classifyAskIntent()`, on the classifier model.
   *
   * `context` is structurally askIntent.ts's `AskIntentContextMessage`, spelled
   * inline for the same reason `taskClass` is: that module reaches a provider
   * and is not on the kernel's allowlist. The adapter's assignment is what
   * checks the two still agree.
   */
  classify(
    model: LanguageModel,
    question: string,
    context: readonly { role: "user" | "assistant"; text: string }[],
    signal?: AbortSignal,
  ): Promise<AskIntentRecord>;
  /** Where the one `ai.grant` record goes. */
  audit(record: AiGrantRecord): void;
}

/**
 * What `selectModel` answers — the kernel's spelling of `ModelSelection`
 * (modelSelection.ts), which lives behind the import wall because it reaches
 * the gateway and the kill-switch flag.
 *
 * The one difference is `denied`: it carries its own Response instead of a
 * reason this file renders. `deniedResponse` exists *"so /ask's two halves
 * render the same refusal rather than each inventing its own shape"*, and a
 * kernel that rebuilt that 403 from a copied code string would be the second
 * shape it was written to prevent.
 */
export type ModelChoice =
  | {
      outcome: "live";
      /**
       * Every tier's model, resolved. The kernel names a SLOT — `cheap`, `mid`,
       * `strong` — and never a model id; which id fills a slot is configuration
       * on the far side of this port (spec §5b).
       */
      models: TierModels;
      classifierModel: LanguageModel;
      entitlements: ResolvedEntitlements;
    }
  | {
      outcome: "simulated";
      models: TierModels;
      classifierModel: LanguageModel;
      entitlements: ResolvedEntitlements;
    }
  | { outcome: "denied"; reason: string; code: string; response: Response };

/**
 * What `admitQuota` answers — `QuotaDecision` (quota.ts, which reaches
 * Postgres) with its refusal already rendered, for `ModelChoice`'s reason:
 * `quotaRefusal` owns the 429/503 split and the `Retry-After` header, and
 * neither belongs in two places.
 */
export type QuotaVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; response: Response };

export interface AdmissionInput {
  request: Request;
  tripId: string;
  /**
   * Test seam: an injected model is used as-is and the flag is never
   * consulted. `simulated` is still derived from its IDENTITY — see
   * `selectModel`.
   */
  model?: LanguageModel;
  ports: AdmissionPorts;
}

/**
 * What the stages fill in, in ADMISSION order.
 *
 * Every field a later stage reads is written by an earlier one, and `required`
 * below turns "a stage was removed and its consumer was not" into a loud throw
 * at the point of use rather than an `undefined` that travels. It is the same
 * choice `registry.ts` makes for a missing collector, for the same reason: a
 * wiring mistake must be a test failure, not a turn that fails several steps
 * in on the operator's key.
 */
interface AdmissionDraft {
  readonly input: AdmissionInput;
  actor?: { userId: string; detail: TripDetail; canWrite: boolean };
  raw?: string;
  parsed?: {
    messages: AskUiMessage[];
    scope: AskScope;
    question: string;
    turn: "opening" | "follow-up";
  };
  /** Present once `resolveSurface` has run: null on every non-page surface. */
  surface?: { page: Page | null };
  selected?: {
    /** Every tier's model. Which one answers is not known until `grantTools`. */
    models: TierModels;
    classifierModel: LanguageModel;
    simulated: boolean;
    entitlements: ResolvedEntitlements;
  };
  /** Present once `classifyTask` has run: null when there was nothing to classify. */
  classified?: { classification: AskIntentRecord | null };
  /** What `grantTools`, the last stage, resolved — the value the pipeline returns. */
  granted?: AiGrant;
}

/**
 * A stage's answer, or a throw naming the stage that should have filled it in.
 *
 * The tripwire for reading the draft out of order: an `undefined` allowed
 * through here would fail somewhere downstream, with the one useful fact —
 * which stage never ran — no longer available.
 */
function required<T>(value: T | undefined, stage: AdmissionStageName): T {
  if (value === undefined) {
    throw new Error(`the admission pipeline read a stage's answer without running ${stage}`);
  }
  return value;
}

/** A stage: a name, and a step that either refuses or lets the turn through. */
interface AdmissionStage {
  readonly name: AdmissionStageName;
  run(draft: AdmissionDraft): Promise<AiRefusal | null>;
}

/** A refusal, carrying the stage that issued it — which is what the audit record names. */
function refuse(
  stage: AdmissionStageName,
  reason: string,
  response: Response,
  code: string | null = null,
): AiRefusal {
  return { stage, code, reason, response };
}

// ---------------------------------------------------------------------------
// The stages, in the order they run
// ---------------------------------------------------------------------------

// The demo trip is refused, and it is refused FIRST — before the guard,
// before model selection, before the quota.
//
// `requireTripAccess` answers `isDemoTripId` as a **viewer with no session**
// (ADR-031), which is what makes /demo public. Combined with this endpoint's
// (correct) `viewer` minimum, that would have made /ask an internet-facing,
// unauthenticated LLM proxy on the operator's key the moment `ai-live` is
// switched on — up to 30 attacker-authored turns an hour, all of them
// sharing the single `demo-visitor` quota bucket, so one visitor exhausting
// it denies every other visitor. It would also have put a Postgres write
// (the quota counter) on a path `demoTrip.ts` deliberately keeps free of the
// database, which is an architecture regression rather than a missing
// feature.
//
// Refusing here rather than inside `guard()` keeps the rule where its
// reasoning is, and keeps `requireTripAccess` answering the demo the same
// way for every other route. `docs/known-issues/` (KI-79) records what
// would have to be decided to open it up.
const refuseDemoTrip: AdmissionStage = {
  name: "refuseDemoTrip",
  run: async (draft) => {
    if (!isDemoTripId(draft.input.tripId)) return null;
    const reason = "The assistant isn't available on the demo trip.";
    return refuse(
      "refuseDemoTrip",
      reason,
      Response.json({ error: reason, code: DEMO_TRIP_UNSUPPORTED_CODE }, { status: 403 }),
      DEMO_TRIP_UNSUPPORTED_CODE,
    );
  },
};

// The guard's answer: who is asking, what they may already see, and the trip
// detail it fetched to decide (which every later stage reuses rather than
// re-reading).
//
// **Write tools are offered only when the turn's guard resolved editor.**
//
// Asked through the AccessPolicy seam (`hasAtLeast`), which is the one place
// that knows a viewer ranks below an editor (AGENTS.md invariant 6c) — not a
// second rank table here. `guard()` has already resolved the effective members,
// so `canWrite` is a read of what it decided, not a second access check.
//
// `accessPolicy` is imported rather than injected because it is pure — it is on
// the assistant kernel's own import allowlist for exactly that reason. The
// guard is a port; the rank comparison it hands back is not.
const identifyActor: AdmissionStage = {
  name: "identifyActor",
  run: async (draft) => {
    const g = await draft.input.ports.identifyActor(draft.input.tripId, ASK_MINIMUM_ROLE);
    if ("error" in g) {
      return refuse("identifyActor", "the guard refused this actor", g.error);
    }
    draft.actor = {
      userId: g.userId,
      detail: g.detail,
      canWrite: hasAtLeast(g.userId, g.detail.members, "editor"),
    };
    return null;
  },
};

// Measured on the RAW body, before parsing — see `capRawBody`. A malformed or
// oversized request must not cost the caller their allowance, which is why this
// runs four stages before `admitQuota`.
const capRawBodyStage: AdmissionStage = {
  name: "capRawBody",
  run: async (draft) => {
    const read = await capRawBody(draft.input.request);
    if (!read.ok) return refuse("capRawBody", read.error, badRequest(read.error));
    draft.raw = read.raw;
    return null;
  },
};

// JSON, the request shape, the prompt cap and the turn kind — every rejection
// here is a 400 that names the rule broken, and every one of them costs the
// caller nothing. That is the second of the three recorded orderings: a
// malformed request must not cost the caller their allowance.
const parseRequestStage: AdmissionStage = {
  name: "parseRequest",
  run: async (draft) => {
    const parsed = parseRequest(required(draft.raw, "capRawBody"), AskRequest);
    if (!parsed.ok) return refuse("parseRequest", parsed.error, badRequest(parsed.error));
    const { messages, scope } = parsed.value;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      const reason = "the thread must end with a question from the user";
      return refuse("parseRequest", reason, badRequest(reason));
    }
    const question = textOf(lastUser);
    if (question.length > MAX_PROMPT_CHARS) {
      const reason = `your message must be ${MAX_PROMPT_CHARS} characters or fewer`;
      return refuse("parseRequest", reason, badRequest(reason));
    }
    // A thread of length 1 is just this question — nothing has been answered
    // yet. Any longer thread already holds at least one prior turn, so this
    // question is a follow-up: it reads back over answers already given, and
    // (Design note in askAnalytics.ts) its tool-call shape is genuinely
    // different from an opening question's.
    const turn: "opening" | "follow-up" = messages.length > 1 ? "follow-up" : "opening";
    draft.parsed = { messages, scope, question, turn };
    return null;
  },
};

// **The page scope is VERIFIED here, and this is the load-bearing rule of the
// one-door design (ADR-033 Decision 2).**
//
// `scope` comes off the request body, so `pageId` is something the client
// says. Three facts have to hold before a page tool is offered, and all three
// are established server-side: the page EXISTS, it belongs to THIS trip — the
// tripId in the URL, which `guard()` has already checked this actor against —
// and the actor may EDIT it, which for a Notebook page is `editor` (the pages
// CRUD routes pass the same minimum). Trusting the field instead would be the
// same class of mistake as trusting a `tripId` parameter on a read tool, which
// ADR-022 §3 already forbids.
//
// A claim that does not resolve is REFUSED, and never widened: falling back
// to the trip-wide set would answer a page request with a planning turn,
// which is the widest tool set in the app. "If the surface cannot be resolved
// server-side, the narrowest tool set applies, not the widest."
//
// Missing and not-on-this-trip share one 404 deliberately. `getPage` is keyed
// by id alone, so answering them differently would confirm the existence of a
// page on a trip this actor cannot see.
//
// It runs BEFORE model selection and before the quota, so a bad page id costs
// the caller nothing — the same ordering the demo refusal and the caps above
// have, for the same reason. That is the third recorded ordering, and the one
// this stage's position in ADMISSION exists to hold.
const resolveSurface: AdmissionStage = {
  name: "resolveSurface",
  run: async (draft) => {
    const { scope } = required(draft.parsed, "parseRequest");
    const { detail, canWrite } = required(draft.actor, "identifyActor");

    // A scope pointing past the end of the trip is a client bug, not a
    // question: answering it "about the whole trip" would silently widen a
    // narrowing the caller asked for.
    if (scope.kind === "day" && !detail.days[scope.dayIndex]) {
      const reason = `this trip has ${detail.days.length} days, so day ${scope.dayIndex + 1} is out of range`;
      return refuse("resolveSurface", reason, badRequest(reason));
    }

    if (scope.kind !== "page") {
      draft.surface = { page: null };
      return null;
    }

    const found = await draft.input.ports.loadPage(scope.pageId);
    if (found === null || found.tripId !== draft.input.tripId) {
      const reason = "That page is not on this trip.";
      return refuse(
        "resolveSurface",
        reason,
        Response.json({ error: reason, code: PAGE_NOT_ON_TRIP_CODE }, { status: 404 }),
        PAGE_NOT_ON_TRIP_CODE,
      );
    }
    if (!canWrite) {
      return refuse(
        "resolveSurface",
        "a viewer may read this page but not edit it",
        Response.json({ error: "forbidden" }, { status: 403 }),
      );
    }
    draft.surface = { page: found };
    return null;
  },
};

// Injected model => that exact model, flag never consulted; `simulated` is
// derived from its IDENTITY, not from whether one was injected — so a test
// that injects `simulatedModel()` to exercise the switched-off path is still
// reported, and badged, as simulated.
//
// An injected model classifies as well as answers: one seam, so a test can
// never end up exercising a classifier the turn itself did not use.
//
// **This runs BEFORE `admitQuota`, and it has to.** Charging before selection
// meant a missing AI_GATEWAY_API_KEY (the 503 below) burned the caller's whole
// hourly and daily allowance on retries against an outage that produced zero
// provider calls — the incident outlived its own fix by a day. Spec §7d records
// that M20's per-tier ceilings need the same order for their own reason:
// resolving entitlements has to happen before the ceilings are known, and the
// ceilings are what admission needs. The order the incident forced is the order
// the tier requirement needs, so nothing in this sequence moves.
const selectModel: AdmissionStage = {
  name: "selectModel",
  run: async (draft) => {
    const injected = draft.input.model;
    if (injected) {
      draft.selected = {
        // One model in every slot. The seam exists so a test can pin what the
        // agent is handed; a test that had to know the tier map to do that
        // would be testing the configuration rather than the handler.
        models: { cheap: injected, mid: injected, strong: injected },
        classifierModel: injected,
        simulated: draft.input.ports.isSimulated(modelIdOf(injected)),
        entitlements: PERMITS_EVERYTHING,
      };
      return null;
    }
    const { userId } = required(draft.actor, "identifyActor");
    let outcome: ModelChoice;
    try {
      outcome = await draft.input.ports.selectModel(userId);
    } catch (err) {
      const reason = `model selection failed: ${errorMessage(err)}`;
      return refuse("selectModel", reason, Response.json({ error: reason, simulated: false }, { status: 503 }));
    }
    if (outcome.outcome === "denied") {
      return refuse("selectModel", outcome.reason, outcome.response, outcome.code);
    }
    draft.selected = {
      models: outcome.models,
      classifierModel: outcome.classifierModel,
      simulated: outcome.outcome === "simulated",
      entitlements: outcome.entitlements,
    };
    return null;
  },
};

// **Charged after validation and after model selection**, and that ordering is
// a recorded incident, not a preference — see `selectModel` above for the
// incident and spec §7d for why M20 needs the same order. A malformed request
// must not cost the caller their allowance either. Nothing between selection
// and here reads the counters, so the placement is order-safe. It applies in
// simulated mode too: the limiter's job is to bound requests, not to guess
// which ones reached a provider.
//
// **Two layers, both charged here (KI-67).** `aiQuotas` bounds how many times
// an actor may ask; `aiStepQuotas` bounds what asking COSTS, in model
// round-trips. KI-67 measured that metering requests alone turned a nominal
// ceiling of 30 into a real one of 960, and its fix was wired into the command
// endpoint only — so this endpoint, built afterwards and the door users
// actually reach, was metered the way KI-67 had already proved wrong, for its
// whole life. One door means one quota path; that is the point of the merge
// rather than a bonus from it.
//
// Only one round-trip can be pre-authorised, because the real step count does
// not exist until the run ends; `settleAiSteps` charges the rest from the
// recorder's sink in the handler. An actor already over either ceiling is
// refused here, before a provider is touched. The in-flight overshoot this
// admission shape permits is KI-94, unchanged by the move.
//
// **The ceilings are a PARAMETER of this stage, and that is what makes its
// position structural** (spec §3b, §7d). It is handed
// `ResolvedEntitlements.ceilings` from `selectModel`, so it cannot be moved
// above the stage that resolves them — where before, the ordering the incident
// forced was held by two test assertions and nothing else. M20 link 5 is then
// a change to two numbers rather than to this pipeline: *"`aiQuotas()` and
// `aiStepQuotas()` take entitlements and return different ceilings. The bucket
// `name` must not vary by tier."*
const admitQuota: AdmissionStage = {
  name: "admitQuota",
  run: async (draft) => {
    const { userId } = required(draft.actor, "identifyActor");
    const { entitlements } = required(draft.selected, "selectModel");
    const quota = await draft.input.ports.admitQuota(userId, entitlements.ceilings);
    if (quota.allowed) return null;
    return refuse("admitQuota", `over the ${quota.reason} limit`, quota.response);
  },
};

// **What this turn is for, decided before the agent is built.**
//
// ~85% of a step's fixed input cost is tool schemas, and 12 of the 15 tools
// are write tools that a question never calls — see the measurement in
// askIntent.ts. One extra, tool-less round-trip buys back most of it.
//
// It is handed the two messages before this one, because the turn that
// writes is often the one that says least: the 2026-08-29 thread ended a
// long request with "Yes go ahead", and those three words did all ten
// writes. In isolation they classify as a question — reasonably — and the
// user would have got an assistant that could not act on the one turn that
// mattered. Fail-open does not cover that: nothing fails.
//
// Two properties this stage is responsible for, not the classifier:
//
//   * **It can only narrow.** `canWrite` gates it, so a viewer is never
//     classified at all — there is no write half to withhold, and paying for
//     the call would be waste. `minimumRoleFor` in `grantTools` still has the
//     final word on whatever comes out.
//   * **It runs after the quota.** A turn refused before it reached a model
//     must not have paid for a classification either. That is why this stage
//     is LAST, and it is the third thing the array's order defends.
//
// It goes to `classifierModel`, which is the answer model unless
// AI_CLASSIFIER_MODEL says otherwise — a separate id, still built at
// `selectAiModel`'s one chokepoint, so the kill switch covers both.
//
// `classifyAskIntent` is total — it fails open to `write` rather than
// throwing — so there is deliberately no try/catch here to suggest otherwise.
//
// Sentry sees this call as its own `gen_ai.invoke_agent` run, separate from
// the turn's — `askIntent.ts` names it through `telemetry.functionId`. That
// separation is the point rather than an accident of where the call sits:
// `AI_CLASSIFIER_MODEL` can put the classifier on a cheaper model than the
// one answering, and "did the classifier save more than it cost" is
// unanswerable if its spend is folded into the turn's — the same argument
// `AskIntentRecord.model` makes for the log record.
//   * **A page turn is not classified at all.** Its tool set is decided by a
//     scope the server verified, not by what the sentence sounds like, so
//     there is no write half to withhold and the call would be spend with
//     nothing to buy.
const classifyTask: AdmissionStage = {
  name: "classifyTask",
  run: async (draft) => {
    const { canWrite } = required(draft.actor, "identifyActor");
    const { page } = required(draft.surface, "resolveSurface");
    const { messages, question } = required(draft.parsed, "parseRequest");
    const { classifierModel } = required(draft.selected, "selectModel");
    draft.classified = {
      classification:
        canWrite && page === null
          ? await draft.input.ports.classify(classifierModel, question, recentContext(messages), draft.input.request.signal)
          : null,
    };
    return null;
  },
};

/**
 * **The turn's grant: a minimum over four independent caps, one per domain**
 * (ADR-043 decision 2). Each answers a different question, and the four are
 * not interchangeable — that is why this is not a boolean and not one effect
 * across all domains.
 *
 *   * the SURFACE is `scope.kind`, already verified server-side by
 *     `resolveSurface`;
 *   * the ROLE comes from the guard's members, through the AccessPolicy seam;
 *   * the PLAN has no source yet — `permitsPropose` permits everybody, which
 *     is exactly today's behaviour. M20 owns it (spec §7c);
 *   * the CLASSIFIER is `askIntent`'s answer, and a page turn is not
 *     classified at all (`classification` is null), so it caps nothing.
 *
 * **`offeredToolNamesFor` and the three name manifests are gone** (F-F02,
 * ADR-043 decision 2). A page-authoring turn still gets the page insert tools
 * and NO planning write tools, and a planning turn still gets the write tools
 * and NO page insert tools — one door is not the widest door, and a turn
 * writing into a Notebook page has no business holding `RemoveActivity`
 * (ADR-033 Decision 4). What changed is that this is no longer a sentence three
 * constants have to keep true: it is the `itinerary` domain capped at `read` on
 * the page surface, and the `pages` domain absent from the planning one, in the
 * surface table in `assistant/grants.ts`.
 *
 * Both write halves are still DERIVED — the planning tools from `@tc/contracts`
 * command schemas, the page tools from the `@tc/pages` macro registry — so each
 * grows with its own registry and never with a hand-written manifest (ADR-015
 * invariant 5). They now arrive through the registry rather than through a
 * builder each.
 */
const grantTools: AdmissionStage = {
  name: "grantTools",
  run: async (draft) => {
    const { userId, detail, canWrite } = required(draft.actor, "identifyActor");
    const { messages, scope, question, turn } = required(draft.parsed, "parseRequest");
    const { page } = required(draft.surface, "resolveSurface");
    const selected = required(draft.selected, "selectModel");
    const { classification } = required(draft.classified, "classifyTask");

    const caps = {
      surface: scope.kind,
      role: canWrite ? ("propose" as const) : ("read" as const),
      plan: permitsPropose({ userId }),
      classifier: classification?.intent === "question" ? ("read" as const) : ("propose" as const),
    };
    const grants = grantFor(caps);

    // **What this turn is for, then which slot answers it** (spec §5, §7e).
    // The class is a proposal and the plan is a ceiling, which is the same
    // cap-an-upper-bound shape as `caps` above and as the surface grant — three
    // places, one idea. Nothing here knows a model id: `tier` names a slot and
    // `selected.models` is where the far side of the port already put one.
    const taskClass = taskClassFor(page !== null, classification);
    const tier = capTier(tierFor(taskClass), selected.entitlements.ceilings.maxTier);
    const model = selected.models[tier];

    // **The class is computed BEFORE the tool set, because it narrows it.**
    // It used to be the other way round and the order was invisible: the class
    // only chose a model, so nothing broke when it came second. It now also
    // chooses which tools a turn is offered (`defineTool`'s `taskClasses`), and
    // a `toolsFor` called above this line would silently get the unnarrowed
    // set — the same shape of bug as a grant computed after the tools it
    // governs. **The compiler enforces this, not a test** — moving the call
    // back above is `TS2448: Block-scoped variable 'taskClass' used before its
    // declaration` plus `TS2454`, measured rather than assumed. That is why
    // `taskClass` is passed as an argument instead of read off `draft`: an
    // argument cannot be read early.
    //
    // **A class that was RESOLVED UPWARD does not narrow anything.** Only a
    // class somebody actually determined is allowed to take a tool away.
    //
    // There are two ways a turn arrives at `plan` without anyone having decided
    // it is one, and they are easy to mistake for one condition because only
    // the first sets a flag:
    //
    //   * `failedOpen` — the classifier threw, timed out, or returned a verdict
    //     nothing recognised. This endpoint's answer has been the widest safe
    //     tool set since KI-88.
    //   * `source: "affirmation"` — `isBareAgreement` short-circuits the
    //     classifier for "Yes go ahead" and answers `FAIL_OPEN_TASK_CLASS`,
    //     the SAME `plan`, with `failedOpen: false`. Its own comment says why:
    //     an agreement "can be agreeing to a single stop or to a six-day
    //     itinerary, and this rule is deliberately not a parser."
    //
    // The second is an admission of uncertainty wearing a determined
    // classification's flag, and the first cut of this filter narrowed on it —
    // so the turn that approves *"rename it to Spring Trip and add three days"*
    // was handed a set with no `SetTripName`, and the rename the user had just
    // said yes to silently did not happen. That is the fail-OPEN-to-fail-closed
    // conversion the `failedOpen` guard exists to prevent, arriving by the one
    // door the guard did not cover. Found by review, not by us.
    //
    // A page turn has no classification at all and is NOT this case: `compose`
    // is decided structurally from a scope `resolveSurface` verified, which is
    // the strongest determination on offer, so it narrows.
    const resolvedUpward =
      classification !== null && (classification.failedOpen || classification.source === "affirmation");
    const narrowBy = resolvedUpward ? undefined : taskClass;

    // Both sets, because "did the class filter take anything away" is the
    // question the instruction needs answered, and it is a MEASUREMENT — the
    // same rule `tools` itself follows. Inferring it from `taskClass === "plan"`
    // would be a second copy of `TASK_CLASSES_FOR` that drifts the first time
    // a tool's `taskClasses` changes.
    const offerable = toolsFor(grants);
    const tools = narrowBy === undefined ? offerable : toolsFor(grants, narrowBy);
    const classWithheld = tools.length < offerable.length;

    // The rule is enforced rather than commented: `minimumRoleFor` is asked what
    // the set about to be handed to the agent requires — the maximum
    // `minimumRole` over the tools actually selected — and the actor must already
    // satisfy it. Unreachable while the caps above decide the set, which is why
    // it is here: the next person to add a branch to them is who this catches.
    //
    // Every branch is asserted in the /ask route's integration suite.
    const needed = minimumRoleFor(tools);
    if (!hasAtLeast(userId, detail.members, needed)) {
      return refuse(
        "grantTools",
        `this tool set requires ${needed}`,
        Response.json({ error: "forbidden" }, { status: 403 }),
      );
    }

    draft.granted = {
      tripId: draft.input.tripId,
      userId,
      detail,
      surface: scope.kind,
      scope,
      page,
      grants,
      tools,
      posture: postureFor(caps),
      classWithheld,
      model,
      classifierModel: selected.classifierModel,
      modelId: modelIdOf(model),
      simulated: selected.simulated,
      tier,
      entitlements: selected.entitlements,
      classification,
      taskClass,
      messages,
      question,
      turn,
    };
    return null;
  },
};

/**
 * **What a turn is for — the surface first, then the classifier.**
 *
 * Total by construction, and the two fallbacks are decisions rather than
 * defaults:
 *
 *   * a **page turn is `compose`**, decided structurally. Its tool set comes
 *     from a scope `resolveSurface` verified server-side, not from what the
 *     sentence sounds like, so paying for a classification would be spend with
 *     nothing to buy — which is exactly why `classifyTask` does not make the
 *     call for a page turn and never has;
 *   * an **unclassified non-page turn is a `question`**. That is a viewer's
 *     turn: `canWrite` gated the call because there was no write half to
 *     withhold, and a turn that holds only read tools is a question whatever it
 *     sounds like.
 *
 * Exported for the test that pins both, because neither is derivable from the
 * classifier's own record — which is null in both cases.
 */
export function taskClassFor(isPageTurn: boolean, classification: AskIntentRecord | null): TaskClass {
  if (isPageTurn) return "compose";
  return classification?.taskClass ?? "question";
}

/**
 * **The order is a value, not statement order.**
 *
 * Three of the transitions are recorded incidents, and each one's comment sits
 * on its stage above:
 *
 *   * charging before model selection burned a caller's whole allowance
 *     against an outage that produced zero provider calls (`selectModel`);
 *   * a malformed request must not cost an allowance (`capRawBody`,
 *     `parseRequest`);
 *   * a bad page id must cost nothing (`resolveSurface`).
 *
 * Written as an array so those three are defended by a test that watches the
 * stages run rather than by three comments somebody has to read before moving
 * a line. Spec §7d: `selectModel` before `admitQuota` is also the order M20's
 * per-tier ceilings need, so this sequence is load-bearing twice.
 *
 * `grantTools` is the ninth and last (spec §3b): it can refuse, which is what
 * makes it a stage rather than an epilogue, and the order test now covers the
 * name every refusal is allowed to carry rather than eight of the nine.
 */
export const ADMISSION: readonly AdmissionStage[] = [
  refuseDemoTrip,
  identifyActor,
  capRawBodyStage,
  parseRequestStage,
  resolveSurface,
  selectModel,
  admitQuota,
  classifyTask,
  grantTools,
];

// ---------------------------------------------------------------------------
// The verdict, and the record
// ---------------------------------------------------------------------------

/**
 * One line per admission decision — **the answer to "what is and isn't
 * allowed"**.
 *
 * `console.info`, matching `ai.ask` (askAnalytics.ts) and `ai.proposal.apply`:
 * no table and no migration (ADR-043 builds ports, not policy), and Vercel
 * captures it as a queryable line. Every field is server-resolved — a stage
 * name, a role's answer, a tool name from the registry, a model id — so unlike
 * `ai.ask` this record carries nothing a model wrote and needs no sanitising.
 */
export interface AiGrantRecord {
  event: "ai.grant";
  tripId: string;
  /** Null when the refusal came before the guard answered. */
  userId: string | null;
  outcome: "granted" | "refused";
  surface: SurfaceKind | null;
  /** The granted (domain, effect) pairs — the whole of what this turn may do. */
  grants: Partial<Record<string, ToolEffect>> | null;
  /** The tools actually offered, in registry order. */
  tools: string[] | null;
  model: string | null;
  simulated: boolean | null;
  /** Which slot the model came from — `null` on a refusal before `grantTools`. */
  tier: ModelTier | null;
  /** What the turn was for. Null on a refusal that never resolved one. */
  taskClass: TaskClass | null;
  /** Which stage refused, and why. Both null on a grant. */
  refusedBy: AdmissionStageName | null;
  reason: string | null;
  /** The machine code the client branches on, when the refusal carries one. */
  code: string | null;
  status: number | null;
}

/**
 * Where the record goes. The console sink lives at the app's edge
 * (`admissionPorts.ts`) rather than here, because writing it turns out to need
 * one fact about Sentry — see the comment there.
 */
export type AiGrantSink = (record: AiGrantRecord) => void;

/**
 * Run the pipeline, resolve the grant, and emit exactly one record either way.
 *
 * The loop is the whole of the control flow: a stage either refuses — and the
 * refusal names it — or fills in its part of the draft and the next one runs.
 * The last stage fills in the grant, so there is one audit call per outcome
 * and no branch outside the loop that could grow a second one.
 */
export async function evaluateAiGrant(input: AdmissionInput): Promise<AiAdmission> {
  const draft: AdmissionDraft = { input };
  for (const stage of ADMISSION) {
    const refusal = await stage.run(draft);
    if (refusal !== null) {
      input.ports.audit(refusedRecord(draft, refusal));
      return { ok: false, refusal };
    }
  }
  const grant = required(draft.granted, "grantTools");
  input.ports.audit(grantedRecord(grant));
  return { ok: true, grant };
}


/**
 * The `ai.grant` record for a turn that was let through.
 *
 * Paired with `refusedRecord`: the two fill the same field set, each nulling
 * what its own outcome cannot know, so a reader of the log never has to ask
 * which shape an entry has before reading a field.
 */
function grantedRecord(grant: AiGrant): AiGrantRecord {
  return {
    event: "ai.grant",
    tripId: grant.tripId,
    userId: grant.userId,
    outcome: "granted",
    surface: grant.surface,
    grants: grant.grants,
    tools: grant.tools.map((tool) => tool.name),
    model: grant.modelId,
    simulated: grant.simulated,
    tier: grant.tier,
    taskClass: grant.taskClass,
    refusedBy: null,
    reason: null,
    code: null,
    status: null,
  };
}

/**
 * The `ai.grant` record for a turn a stage refused, assembled from however much
 * of the draft the stages before it had filled in — which is why almost every
 * field here is read through an optional and falls back to null.
 */
function refusedRecord(draft: AdmissionDraft, refusal: AiRefusal): AiGrantRecord {
  return {
    event: "ai.grant",
    tripId: draft.input.tripId,
    userId: draft.actor?.userId ?? null,
    outcome: "refused",
    surface: draft.parsed?.scope.kind ?? null,
    grants: null,
    tools: null,
    // The tier a refused turn would have run on is not knowable — the class is
    // resolved by the stage that refused or by one after it — so the model this
    // names is the MID slot, the one a turn falls back to when nothing narrowed
    // it. Stated here rather than left to a reader of the log, because "which
    // model did the refused turn name" is otherwise a question with three
    // possible answers.
    model: draft.selected === undefined ? null : modelIdOf(draft.selected.models.mid),
    simulated: draft.selected?.simulated ?? null,
    tier: null,
    taskClass: draft.classified?.classification?.taskClass ?? null,
    refusedBy: refusal.stage,
    reason: refusal.reason,
    code: refusal.code,
    status: refusal.response.status,
  };
}

// A LanguageModel is either a bare model-id string or a provider model object
// carrying `.modelId` — normalize to the requested id either way.
export function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
