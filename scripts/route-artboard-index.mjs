import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// KI-2026-09-14-c, gap 1: THERE IS NO INDEX FROM A ROUTE TO ITS ARTBOARD.
// `handoff/README.md` lists design FILES and what each is for; it has never
// said which part of the 844 KB design file draws `/admin`. Finding the
// operator console meant guessing a heading and grepping for it. That works
// once you think to do it, and the whole failure the KI records is that nobody
// thinks to do it — four review rounds and three wrong builds on one screen.
//
// The design file is route-driven rather than artboard-titled: a screen is a
// `<sc-if value="{{ isAdminRoute }}">` block, and its `route` value is set by
// the `startScreen`/nav state. So the index is app route → that gate → the
// `SPEC.md` sections that describe it, and the line number is derived rather
// than typed, because a hand-typed one is stale the next time the design side
// touches the file and nothing says so.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const README_PATH = join(REPO_ROOT, ".design-sync", "handoff", "README.md");
export const DESIGN_PATH = join(REPO_ROOT, ".design-sync", "handoff", "design", "Trip Planner Redesign.dc.html");
export const SPEC_PATH = join(REPO_ROOT, ".design-sync", "handoff", "SPEC.md");
export const APP_DIR = join(REPO_ROOT, "apps", "web", "src", "app");

const START = "<!-- ROUTE-ARTBOARD-INDEX:START -->";
const END = "<!-- ROUTE-ARTBOARD-INDEX:END -->";

// The durable half — the part a person decided and a script cannot infer.
// `gate` is the `<sc-if value="{{ … }}">` the design file wraps that screen in;
// `spec` is the section numbers that describe it. Line numbers are NOT here.
export const ROUTES = [
  { route: "/", gate: "isHome", spec: [28, 32], note: "Trips, the new-trip fork and the import entry" },
  { route: "/trips/[tripId]", gate: "isTrip", spec: [24, 25], note: "The four tabs; Overview is a notebook page" },
  { route: "/trips/[tripId]/pages", gate: "isNotebook", spec: [7, 18, 19], note: "Notebook index" },
  { route: "/trips/[tripId]/pages/[pageId]", gate: "isDoc", spec: [18, 21, 26], note: "One page, and the widget framework" },
  { route: "/playbooks", gate: "isPlaybooks", spec: [15, 33], note: "Discover — §33 re-sorts the header by kind of decision" },
  { route: "/playbooks/day/[savedDayId]", gate: "isDay", spec: [15, 16, 33], note: "The shared day; §16 gives it a map, §33 gives it day scope" },
  { route: "/playbooks/board", gate: "isBoard", spec: [15], note: "Leaderboard" },
  { route: "/playbooks/profile/[userId]", gate: "isProfile", spec: [15], note: "Public profile" },
  { route: "/plans", gate: "isPlansRoute", spec: [29, 34], note: "§34.3 adds the phone treatment" },
  { route: "/account", gate: "isAccountRoute", spec: [12, 34], note: "NOT BUILT YET — a Sheet today; M26 link 1 makes it this route" },
  { route: "/admin", gate: "isAdminRoute", spec: [17], note: "Operator console. The artboard also draws M21's strip — read M20 link 7's split note" },
  { route: "/welcome", gate: "isDeskLanding", spec: [14, 17], note: "The landing page; `isPhoneLanding` is its phone artboard. §17.1 is the pricing block" },
  { route: "/signin", gate: "isSignin", spec: [14, 28], note: "Inside the `isAuth` block" },
  { route: "/signup", gate: "isSignup", spec: [14, 28], note: "Inside the `isAuth` block" },
  // The two read-only entrances have no artboard of their own ON PURPOSE, and
  // that is the single most useful line in this table: SPEC §27 says read-only
  // is "a `readOnly` mode over the ordinary trip surface, not a separate demo
  // route". The build has separate screen components for both, so anyone
  // looking for a demo artboard to copy will not find one and must not invent
  // one.
  { route: "/demo", gate: "isTrip", spec: [27], note: "No artboard of its own — the trip surface in `readOnly` (§27)" },
  { route: "/s/[token]", gate: "isTrip", spec: [27], note: "No artboard of its own — the trip surface in `readOnly` (§27)" },
  { route: "/invite/[token]", gate: null, spec: [17], note: "Undrawn. The gate it leads to is §17.3, in Trip settings" },
];

// A route that is deliberately outside the design. Anything not here and not
// above fails the test, so a new route forces the question "what draws this?"
// to be answered once rather than rediscovered per builder.
export const NOT_DRAWN = new Map([
  ["/sentry-example-page", "Sentry's wizard scaffold — not product UI (see the colour wall's same exemption)"],
]);

/** Every route in the app, as a Next.js path with its groups stripped. */
export function appRoutes(dir = APP_DIR, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") found.push(prefix === "" ? "/" : prefix);
      continue;
    }
    // `(app)` and `(front)` are route groups: they organise files and do not
    // appear in the URL. `@modal`-style parallel routes and `_private` folders
    // are not used here, so groups are the only case to unwrap.
    const segment = /^\(.*\)$/.test(entry) ? "" : `/${entry}`;
    found.push(...appRoutes(full, prefix + segment));
  }
  if (readdirSync(dir).includes("page.tsx")) found.push(prefix === "" ? "/" : prefix);
  return [...new Set(found)].sort();
}

/** Line of the `<sc-if>` the design file wraps a screen in. */
export function gateLine(designSource, gate) {
  const lines = designSource.split("\n");
  const needle = `<sc-if value="{{ ${gate} }}"`;
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? null : index + 1;
}

/** Split out so a test can drive it with a gate the design file does not have. */
export function buildRows(routes, design) {
  return routes.map((entry) => {
    const line = entry.gate === null ? null : gateLine(design, entry.gate);
    if (entry.gate !== null && line === null) {
      throw new Error(
        `route-artboard index: \`${entry.gate}\` (for ${entry.route}) is no longer in the design file — the design side renamed or removed it`,
      );
    }
    const where = entry.gate === null ? "_not drawn_" : `\`${entry.gate}\` · line ${line}`;
    const spec = entry.spec.map((n) => `§${n}`).join(", ");
    return `| \`${entry.route}\` | ${where} | ${spec} | ${entry.note} |`;
  });
}

export function buildTable() {
  const rows = buildRows(ROUTES, readFileSync(DESIGN_PATH, "utf8"));
  return [
    START,
    "",
    "### Route → artboard → spec",
    "",
    "**Generated — do not edit by hand.** Run `node scripts/route-artboard-index.mjs --write`;",
    "`pnpm test` fails when a gate below has been renamed out of the design file, when a line",
    "number has drifted, or when the app grows a route nobody has decided an artboard for.",
    "",
    "The design file is one document, not a folder of artboards: a screen is the",
    "`<sc-if value=\"{{ … }}\">` block named below, reached by driving `startScreen` and the nav.",
    "Open the line, then read the `SPEC.md` sections beside it — **in that order**, and diff both",
    "against the milestone link that owns the screen before writing code",
    "(`docs/guidelines/building-from-the-design.md`).",
    "",
    "| Route | Where it is drawn | Spec | Notes |",
    "|---|---|---|---|",
    ...rows,
    "",
    END,
    "",
  ];
}

export function render(source) {
  const start = source.indexOf(START);
  const block = buildTable();
  if (start === -1) {
    throw new Error(`${README_PATH}: no ${START} marker — add it where the index should sit`);
  }
  const end = source.indexOf(END);
  if (end === -1) throw new Error(`${README_PATH}: found ${START} with no matching ${END}`);
  const after = end + END.length;
  // The rendered block already ends in a newline of its own (its last element
  // is an empty string), so exactly ONE of the two newlines after the end
  // marker belongs to it. Eating both closes the gap before the next heading;
  // eating neither opens a new one every run. Either way `--write` stops being
  // idempotent and the check fails immediately after a write.
  const trailing = source.slice(after).startsWith("\n\n") ? after + 1 : after;
  return source.slice(0, start) + block.join("\n") + source.slice(trailing);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invokedDirectly) {
  const source = readFileSync(README_PATH, "utf8");
  const next = render(source);
  if (process.argv.includes("--write")) {
    if (next === source) console.log("route→artboard index already current");
    else {
      writeFileSync(README_PATH, next);
      console.log(`route→artboard index written (${ROUTES.length} routes)`);
    }
  } else if (next !== source) {
    console.error("the route→artboard index is out of date — run `node scripts/route-artboard-index.mjs --write`");
    process.exit(1);
  } else {
    console.log(`route→artboard index OK (${ROUTES.length} routes)`);
  }
}
