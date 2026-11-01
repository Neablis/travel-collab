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
// 3. anything on the public side — a `v1/` route, the `server/public-api/`
//    helpers they delegate to, or the MCP server's modules (`server/mcp/**`,
//    and `app/api/mcp/**` with its tool table) — imports what a `never` line
//    says it reaches, or a `v1/` route sits at a `never` route's own path.
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
  | { status: "never"; why: string; reaches: readonly Reach[] }
  /**
   * Public, but outside `v1/` because a standard fixes its shape (ADR-083 §9):
   * the OAuth server's endpoints, and the MCP server. `adapts: "v1"` when it
   * serves v1's own handlers under another protocol; omitted when it carries no
   * data at all.
   */
  | { status: "front-door"; why: string; adapts?: "v1" };

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
  // M49 decision 8: set from a URL, moved, read and cleared over the API.
  "trips/[tripId]/cover": { status: "public", v1: ["trips/[tripId]/cover"] },

  // ── Planned (Mitchell, 2026-09-30) ───────────────────────────────────────
  "account/preferences": PLANNED("Units and the 12/24-hour clock"),
  "saved-days/[savedDayId]/publish": PLANNED("Publishing a saved day"),
  "saved-days/[savedDayId]/reviews": PLANNED("Reviews of saved days (M12)"),
  "saved-notebooks": PLANNED("Saved notebook templates"),
  "saved-notebooks/[savedNotebookId]": PLANNED("Saved notebook templates"),
  "trips/[tripId]/saved-notebooks/[savedNotebookId]": PLANNED("Applying a saved notebook template to a trip"),
  "trips/[tripId]/members/[userId]": PLANNED(
    "Removing a member, changing a role and setting who is travelling, behind a new members scope",
  ),
  "trips/[tripId]/duplicate": PLANNED("Duplicating a trip"),
  "playbooks/board": PLANNED("Playbook board"),
  "playbooks/profile/[userId]": PLANNED("Playbook profile"),
  reports: PLANNED("Reporting content — behind a new admin scope, with the admin review routes"),
  "admin/reports": PLANNED("Reviewing reports and removing reviews — admin scope"),
  "admin/reports/[reportId]": PLANNED("Reviewing reports and removing reviews — admin scope"),
  "admin/accounts/[accountId]/test-mode": PLANNED("Undecided — admin scope if ever"),
  "admin/grants": PLANNED("Undecided — admin scope if ever"),
  "admin/overview": PLANNED("Undecided — admin scope if ever"),
  "admin/assistant/personas": PLANNED("Undecided — admin scope if ever"),
  "admin/assistant/turns/[turnId]": PLANNED("Undecided — admin scope if ever"),
  // Spec 2026-10-03 W14: one collection, one change resource.
  "trips/[tripId]/suggestions": PLANNED("Suggestions — not on the public API in v1"),
  "trips/[tripId]/suggestions/changes/[changeId]": PLANNED("Suggestions — not on the public API in v1"),
  // M40 D1: accept several as one batch.
  "trips/[tripId]/suggestions/changes/accept": PLANNED("Suggestions — not on the public API in v1"),
  // M46 (ADR-073): a trip's chat, on the internal API first.
  "trips/[tripId]/chat": PLANNED("Undecided — a trip's chat, reading and posting (M46)"),
  "trips/[tripId]/chat/[messageId]": PLANNED("Undecided — editing and deleting a chat message (M46)"),
  "trips/[tripId]/chat/read": PLANNED("Undecided — a member's chat read cursor (M46)"),
  // Undecided (Mitchell, 2026-09-30): these start as planned, not never.
  places: PLANNED("Undecided — place search over the published library"),
  "trips/[tripId]/events": PLANNED("Undecided — the live event stream"),
  "invites/[token]": PLANNED("Undecided — reading an invite by its token"),
  "invites/[token]/accept": PLANNED("Undecided — accepting an invite"),
  "invites/[token]/preview": PLANNED("Undecided — the trip as an invite's holder sees it before joining (M38 D4)"),
  "shares/[token]": PLANNED("Undecided — reading a share link"),
  "shares/[token]/clone": PLANNED("Undecided — cloning from a share link"),
  "trips/[tripId]/membership": PLANNED("Undecided — leaving a trip"),
  // M34 D15: an internal route first; features ship before their endpoints.
  "trips/[tripId]/nearby-stops": PLANNED("Undecided — library stops near a trip day (M34)"),
  // M40 part 2: named snapshots on the internal API first.
  "trips/[tripId]/snapshots": PLANNED("Undecided — a trip's named snapshots (M40)"),
  "trips/[tripId]/snapshots/[snapshotId]": PLANNED("Undecided — renaming and deleting a snapshot (M40)"),
  "trips/[tripId]/snapshots/[snapshotId]/restore": PLANNED("Undecided — restoring a snapshot, one revert batch (M40)"),

  // ── Front doors (ADR-083 §9) ─────────────────────────────────────────────
  // The authorization server's endpoints: they issue the credential a client
  // calls v1 with, and carry no trip or library data themselves.
  "oauth/register": { status: "front-door", why: "RFC 7591 client registration for the MCP connector" },
  "oauth/token": { status: "front-door", why: "RFC 6749 token endpoint for the MCP connector" },
  "oauth/revoke": { status: "front-door", why: "RFC 7009 token revocation for the MCP connector" },
  "oauth/authorize": {
    status: "front-door",
    why: "The consent decision for the MCP connector; session-only, never a credential",
  },
  // The MCP connector: v1's own declared handlers, under another protocol.
  mcp: {
    status: "front-door",
    adapts: "v1",
    why: "The MCP server Claude connects to; every tool calls a v1 route's declared handler (M55 D2)",
  },

  // ── Never ────────────────────────────────────────────────────────────────
  // M45: the account assistant, on the trip door's terms.
  ask: {
    status: "never",
    why: "The assistant — a token cannot spend model budget",
    reaches: [{ module: "@/server/ai/handleAskRequest" }],
  },
  "ask/outcome": {
    status: "never",
    why: "The assistant — a token cannot spend model budget",
    reaches: [{ module: "@/server/ai/handleAskRequest" }],
  },
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
  "cron/embed-days": {
    status: "never",
    why: "The embed-queue sweep — runs on Vercel Cron's secret, never on an API token",
    reaches: [{ module: "@/server/ai/sweep" }, { module: "@/server/cronAuth" }],
  },
  "cron/tier-rollup": {
    status: "never",
    why: "The weekly tier rollup — runs on Vercel Cron's secret, never on an API token",
    reaches: [{ module: "@/server/entitlements/tierRollup" }, { module: "@/server/cronAuth" }],
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
  // M55 D10. Symbol-limited: v1's wrapper records a grant's last use through
  // the same module.
  "account/connected-apps": {
    status: "never",
    why: "A grant that could list grants could read what else its owner connected",
    reaches: [{ module: "@/server/oauth/grants", symbols: ["listGrants"] }],
  },
  "account/connected-apps/[grantId]": {
    status: "never",
    why: "A grant that could revoke grants could cut off the apps beside it",
    reaches: [{ module: "@/server/oauth/grants", symbols: ["revokeGrant"] }],
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
  // M49 decision 8: the API takes a cover found elsewhere, not a search.
  "trips/[tripId]/cover/search": {
    status: "never",
    why: "Searching Unsplash would spend Caesura's quota on another program's behalf (ADR-081 item 7)",
    reaches: [{ module: "@/server/coverRoutes", symbols: ["coverSearch"] }, { module: "@/server/external/unsplash" }],
  },
  // Mitchell, 2026-10-26: playbook-day covers join the API for URL covers
  // only, reversing M49 decision 8's "stay off" for this path — so an agent
  // with a token can set its own Playbook's cover without Unsplash. The
  // day's search stays never, below: it would spend Caesura's quota.
  "saved-days/[savedDayId]/cover": { status: "public", v1: ["playbooks/[playbookId]/cover"] },
  "saved-days/[savedDayId]/cover/search": {
    status: "never",
    why: "Searching Unsplash would spend Caesura's quota on another program's behalf (ADR-081 item 7)",
    reaches: [{ module: "@/server/coverRoutes", symbols: ["coverSearch"] }, { module: "@/server/external/unsplash" }],
  },
  "dev/content/playbooks": { status: "never", why: "Development-only seeding", reaches: [] },
  "dev/reset-demo-data": { status: "never", why: "Development-only seeding", reaches: [] },
  "dev/saved-days": { status: "never", why: "Development-only seeding", reaches: [] },
  // M49: the bytes of a URL cover, served to a browser on a signature the
  // serializer minted; the API answers the cover itself, `proxySrc` included.
  "cover-image": { status: "never", why: "A cover's image bytes for a browser, not data", reaches: [] },
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
