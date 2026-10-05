// **What the public API may, may not, and does not yet expose — one line per
// internal route** (Mitchell, 2026-09-30).
//
// This is not a registry of the public surface: that is still the directory
// (`conformance.test.ts`, Decision 11), and nothing here decides a URL. It is
// the decision *about* each internal capability — published, not yet, or never —
// written where a test can hold the API to it. `exposure.test.ts` fails when:
//
// 1. an internal route under `src/app/api/**` (outside `v1/`) has no line here,
//    so every new feature says in one line where it stands, and the list of
//    `planned` lines IS the gap list `using-the-api.md` asks an API pass to read;
// 2. a `public` line names a `v1/` route that does not exist;
// 3. anything on the public side — a `v1/` route, or the `server/public-api/`
//    helpers they delegate to — imports what a `never` line says it reaches, or
//    a `v1/` route sits at a `never` route's own path.
//
// **What check 3 cannot see**: the same logic rewritten from scratch inside
// `v1/`. It catches the realistic mistake — an endpoint that calls the function
// the app already has — and the `why` is there so a reviewer catches the rest.

/** A module (as `@/server/...`), or only some of its named exports. */
export interface Reach {
  module: string;
  /** Omitted = any import of the module. */
  symbols?: readonly string[];
}

export type Exposure =
  /** Served by these `v1/` routes, as paths under `app/api/v1/`. */
  | { status: "public"; v1: readonly string[] }
  /** Wanted, not built. `note` says what it is waiting on. */
  | { status: "planned"; note: string }
  /** Never on the public API. `reaches` is what a `v1` route must not import. */
  | { status: "never"; why: string; reaches: readonly Reach[] };

const PLANNED = (note: string): Exposure => ({ status: "planned", note });

/** Keyed by the route's directory under `app/api/`, exactly as on disk. */
export const EXPOSURE: Readonly<Record<string, Exposure>> = {
  // ── Published ────────────────────────────────────────────────────────────
  "account/plan": { status: "public", v1: ["account"] },
  cities: { status: "public", v1: ["cities"] },
  // The tripless place search (Mitchell, 2026-09-30; API feedback item 12).
  geocode: { status: "public", v1: ["geocode"] },
  playbooks: { status: "public", v1: ["discover/playbooks"] },
  "saved-days": { status: "public", v1: ["library", "playbooks"] },
  "saved-days/[savedDayId]": { status: "public", v1: ["library/[savedDayId]", "playbooks/[playbookId]"] },
  trips: { status: "public", v1: ["trips"] },
  "trips/[tripId]": { status: "public", v1: ["trips/[tripId]"] },
  "trips/[tripId]/access": { status: "public", v1: ["trips/[tripId]/members"] },
  "trips/[tripId]/globals": { status: "public", v1: ["trips/[tripId]/globals"] },
  "trips/[tripId]/history": { status: "public", v1: ["trips/[tripId]/history"] },
  "trips/[tripId]/history/[seq]": { status: "public", v1: ["trips/[tripId]/history/[seq]"] },
  "trips/[tripId]/invites": { status: "public", v1: ["trips/[tripId]/invites"] },
  "trips/[tripId]/invites/[inviteId]": { status: "public", v1: ["trips/[tripId]/invites/[inviteId]"] },
  "trips/[tripId]/pages": { status: "public", v1: ["trips/[tripId]/pages"] },
  "trips/[tripId]/pages/[pageId]": { status: "public", v1: ["trips/[tripId]/pages/[pageId]"] },
  "trips/[tripId]/saved-days/[savedDayId]": { status: "public", v1: ["trips/[tripId]/playbook-applications"] },
  "trips/[tripId]/shares": { status: "public", v1: ["trips/[tripId]/shares"] },
  "trips/[tripId]/shares/[shareId]": { status: "public", v1: ["trips/[tripId]/shares/[shareId]"] },

  // ── Planned (Mitchell, 2026-09-30) ───────────────────────────────────────
  "account/preferences": PLANNED("Units and the 12/24-hour clock"),
  "saved-days/[savedDayId]/publish": PLANNED("Publishing a saved day"),
  "saved-days/[savedDayId]/reviews": PLANNED("Reviews of saved days (M12)"),
  "saved-notebooks": PLANNED("Saved notebook templates"),
  "saved-notebooks/[savedNotebookId]": PLANNED("Saved notebook templates"),
  "trips/[tripId]/saved-notebooks/[savedNotebookId]": PLANNED("Applying a saved notebook template to a trip"),
  "trips/[tripId]/members/[userId]": PLANNED(
    "Removing a member (and changing a role, which the app cannot do yet) behind a new members scope, owner only",
  ),
  "trips/[tripId]/duplicate": PLANNED("Duplicating a trip"),
  "playbooks/board": PLANNED("Playbook board"),
  "playbooks/profile/[userId]": PLANNED("Playbook profile"),
  reports: PLANNED("Reporting content — behind a new admin scope, with the admin review routes"),
  "admin/reports": PLANNED("Reviewing reports and removing reviews — admin scope"),
  "admin/reports/[reportId]": PLANNED("Reviewing reports and removing reviews — admin scope"),
  "admin/grants": PLANNED("Undecided — admin scope if ever"),
  "admin/overview": PLANNED("Undecided — admin scope if ever"),
  // Spec 2026-10-03 W14: one collection, one change resource.
  "trips/[tripId]/suggestions": PLANNED("Suggestions — not on the public API in v1"),
  "trips/[tripId]/suggestions/changes/[changeId]": PLANNED("Suggestions — not on the public API in v1"),
  // Undecided (Mitchell, 2026-09-30): these start as planned, not never.
  places: PLANNED("Undecided — place search over the published library"),
  "trips/[tripId]/events": PLANNED("Undecided — the live event stream"),
  "invites/[token]": PLANNED("Undecided — reading an invite by its token"),
  "invites/[token]/accept": PLANNED("Undecided — accepting an invite"),
  "shares/[token]": PLANNED("Undecided — reading a share link"),
  "shares/[token]/clone": PLANNED("Undecided — cloning from a share link"),
  "trips/[tripId]/membership": PLANNED("Undecided — leaving a trip"),
  // M34 D15: an internal route first; features ship before their endpoints.
  "trips/[tripId]/nearby-stops": PLANNED("Undecided — library stops near a trip day (M34)"),

  // ── Never ────────────────────────────────────────────────────────────────
  "trips/[tripId]/ask": {
    status: "never",
    why: "The assistant — a token cannot spend model budget",
    reaches: [{ module: "@/server/ai/handleAskRequest" }],
  },
  "trips/[tripId]/ask/apply": {
    status: "never",
    why: "The assistant — a token cannot spend model budget",
    reaches: [{ module: "@/server/ai/handleAskRequest" }],
  },
  "health/ai-mode": {
    status: "never",
    why: "Operator diagnostics for the assistant",
    reaches: [{ module: "@/server/ai/modelSelection" }],
  },
  "account/referrals": {
    status: "never",
    why: "Referrals grant plan time; scripted, they can be gamed (Mitchell, 2026-09-30)",
    reaches: [{ module: "@/server/entitlements/referrals" }],
  },
  "account/tokens": {
    status: "never",
    why: "A token that could mint tokens could widen itself and outlive its own revocation",
    // Not the whole module: every v1 call verifies its token through it.
    reaches: [{ module: "@/server/api-tokens", symbols: ["mintToken", "listTokens"] }],
  },
  "account/tokens/[tokenId]": {
    status: "never",
    why: "A token that could revoke tokens could lock its owner out of their own",
    reaches: [{ module: "@/server/api-tokens", symbols: ["revokeToken"] }],
  },
  "billing/change": {
    status: "never",
    why: "Moves money — session-only forever",
    reaches: [{ module: "@/server/billing/planChange" }, { module: "@/server/billing/checkout" }],
  },
  "billing/checkout": {
    status: "never",
    why: "Moves money — session-only forever",
    reaches: [{ module: "@/server/billing/checkout" }],
  },
  "billing/portal": {
    status: "never",
    why: "Moves money — session-only forever",
    reaches: [{ module: "@/server/billing/checkout" }],
  },
  "stripe/webhook": {
    status: "never",
    why: "Stripe's callback, authenticated by Stripe's signature, not a caller's token",
    reaches: [{ module: "@/server/billing/webhook" }, { module: "@/server/billing/signature" }],
  },
  "auth/[...nextauth]": {
    status: "never",
    why: "Sign-in; a token is already signed in",
    reaches: [{ module: "@/server/auth", symbols: ["handlers", "signIn", "signOut"] }],
  },
  "dev/content/playbooks": { status: "never", why: "Development-only seeding", reaches: [] },
  "dev/reset-demo-data": { status: "never", why: "Development-only seeding", reaches: [] },
  "dev/saved-days": { status: "never", why: "Development-only seeding", reaches: [] },
  "og/invite/[token]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/invite/[token]/meta": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/referral/[code]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/referral/[code]/meta": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/city/[city]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/city/[city]/meta": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/country/[code]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/day/[savedDayId]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/day/[savedDayId]/meta": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/profile/[userId]": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "og/playbooks/profile/[userId]/meta": { status: "never", why: "Link-preview images for chat apps, not data", reaches: [] },
  "trips/[tripId]/commands": {
    status: "never",
    why: "The app's raw command channel; v1 publishes resources (days, stops) over the same domain",
    // Nothing: v1's resources execute these same commands. What is never
    // published is the channel itself, which the path check holds.
    reaches: [],
  },
  "trips/[tripId]/commands/batch": {
    status: "never",
    why: "The app's raw command channel; v1 publishes resources (days, stops) over the same domain",
    // Nothing: v1's resources execute these same commands. What is never
    // published is the channel itself, which the path check holds.
    reaches: [],
  },
  "trips/[tripId]/pages/[pageId]/reset": {
    status: "never",
    why: "Resetting a seeded notebook is an in-app recovery action; left off the API by Mitchell, 2026-09-30",
    reaches: [{ module: "@/server/pageCommands", symbols: ["resetPageToDefault"] }],
  },
  "trips/[tripId]/pages/[pageId]/restore": {
    status: "never",
    why: "Restoring a notebook version is an in-app recovery action; left off the API by Mitchell, 2026-09-30",
    reaches: [{ module: "@/server/pageCommands", symbols: ["restorePageVersion"] }],
  },
  "trips/[tripId]/pages/defaults": {
    status: "never",
    why: "Adding missing seeded notebooks is an in-app recovery action; left off the API by Mitchell, 2026-09-30",
    reaches: [{ module: "@/server/pageCommands", symbols: ["addMissingDefaultPages"] }],
  },
  "trips/[tripId]/weather": {
    status: "never",
    why: "Left off the API by Mitchell, 2026-09-30; it spends an external weather vendor's quota",
    reaches: [{ module: "@/server/external/weather" }, { module: "@/server/external/weather/tripWeather" }],
  },
};
