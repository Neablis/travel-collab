### KI-2026-09-16-d — an exit-gate box behind a paid tier cannot be walked on a Vercel preview

- **Severity:** process, and it costs a milestone box each time. Nothing is
  broken in the product; what is missing is a way to *observe* a tier-gated
  surface on the one deployment the Definition of Done asks us to observe it on.
- **Area:** the Vercel **Preview** environment's `ADMIN_USER_IDS`;
  `apps/web/src/server/entitlements/requireAdmin.ts`; `AGENTS.md`'s Definition
  of Done (the reachability rule); any milestone whose gate says *"walked in a
  browser on the preview"* about a surface a `free` account cannot reach.
- **Symptom / What happens:** a browser walk of a paid surface on a preview
  cannot get past entitling the account.
  - `POST /api/admin/grants` as `dev-m20operator` answers **`404
    {"error":"not-found"}`**. The route is deployed and runs — that body is
    `requireAdminApi()`'s own `notFound()` — the caller simply is not an
    operator. `ADMIN_USER_IDS` is a **build-time** env var, and
    `playwright.config.ts` injects the e2e operator only into the **local** e2e
    server, never into a deployment.
  - The self-serve path is shut as well, and correctly: `/plans` renders every
    plan button `disabled` behind the `<Preview>` shield, and real checkout needs
    `stripe listen` forwarding a webhook to the deployment — the webhook being
    the sole writer of entitlement (M21 link 4).
  - So **no account reachable from a browser can hold a paid plan on a
    preview**, and the walk stops at the first gated click.
- **Found by:** M22's exit-gate walk, 2026-09-16, on PR 185's preview at commit
  `05afc81`. One clause of that box's three (*a `free` account sees an upgrade
  prompt*) was verified; the other two (*mints, copies and revokes by clicking*,
  *time remaining shown*) could not be reached. The box stays open.
- **Why it will recur:** M20 made tiers real and M21 made them purchasable, so
  every milestone from here that adds a surface behind a plan inherits this. M22
  is simply the first. A gate box that cannot be walked is a box that gets
  ticked on weaker evidence, which is the failure the PR template's verification
  section exists to prevent.
- **Fix sketch (not done):** set `ADMIN_USER_IDS` to include a dev id in the
  Vercel **Preview** environment and redeploy (setting the variable alone does
  nothing — it is injected at build). `dev-m20operator` is the natural value,
  since `e2e/adminBootstrap.ts` already grants through that identity. Then the
  operator grant path works on a preview exactly as it does in CI, which is what
  M20 built it for: *"the whole point of link 7 is that this milestone is
  provable without Stripe."*
  - Alternative without a deploy: flip the `admin-console` flag for a dev
    account, which needs dashboard access.
  - Worth recording in `docs/guidelines/environments-and-deploys.md` beside the
    `ADMIN_USER_IDS` row once decided.
- **Update, 2026-09-19 — the fix sketch above is probably WRONG, and the dates
  are what say so.** `ADMIN_USER_IDS` is bound to the Vercel **preview** and
  **production** environments, and it was created **2026-09-14 21:50** — *two
  days BEFORE* the 2026-09-16 walk that got the 404. So "set `ADMIN_USER_IDS`
  in Preview and redeploy" describes a state that **already held when this
  entry was filed**. Setting it is not what is missing.

  **The likely cause is therefore its VALUE, not its absence**, and that fits
  what M20's retro already warns about: `ADMIN_USER_IDS` takes `users.id`
  **verbatim** (`google-<sub>`, never an email), comma-separated and not a JSON
  array, and it fails closed on every one of those — *"which is why a mistake
  looks like silence"*. A value listing a real Google id would be correct for
  production and useless for a **dev-login** operator on a preview, whose id is
  `dev-<username>`. That is a hypothesis, not a finding: the value is stored
  `encrypted` and was **not** read.

  **What was NOT verified, stated so nobody treats this as more than it is:**
  the variable's contents. Vercel's env listing returns `decrypted: false`, so
  binding was confirmed and content was not. A variable set to an empty string
  would look identical in that listing.

  **Next step is a read, not a write:** decrypt or view `ADMIN_USER_IDS` for
  Preview and check whether it contains the `dev-` id
  `e2e/adminBootstrap.ts` grants through. If it does not, the fix is a value
  change rather than a new variable, and the sketch above should be rewritten
  before anybody acts on it.
- **Also 2026-09-19: three status files said this entry was about
  `API_TOKEN_PEPPER`.** It is not, and it never has been — `TODO.md`,
  `docs/milestones/README.md`'s M22 row and `docs/STATUS.md` all named that
  variable as M22's preview blocker, and all three are corrected. For the
  record: `API_TOKEN_PEPPER` is set on **all three** Vercel targets and has
  nothing to do with this box. The wrong name survived because each copy read
  as confirmation of the others while this entry — the only document with the
  fact in it — went unread.
- **Recheck:** as a dev-login operator on a preview,
  `POST <preview>/api/admin/grants` returning **201** instead of 404 means it is
  fixed.
- **Debris to be aware of:** the walk left two dev-login accounts on the preview
  database — `dev-m22walk590121` (with one trip, `M22 walk 2026-09-16T20:22`)
  and a sign-in as `m20operator`. Harmless, and named here so nobody is puzzled
  by them later.
