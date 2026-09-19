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
- **Fix sketch — REWRITTEN 2026-09-19, because the first one was wrong.**

  **It used to read:** *"set `ADMIN_USER_IDS` to include a dev id in the Vercel
  Preview environment and redeploy."* **That variable was already bound to
  Preview when this entry was filed** — created **2026-09-14 21:50**, two days
  before the 2026-09-16 walk that got the 404. So the sketched action describes
  a state that already held, and anybody following it would have set a variable
  that was set, redeployed, and hit the same 404.

  **What is actually left to establish**, in order, cheapest first:

  1. **Read Preview's `ADMIN_USER_IDS` value.** It is stored `encrypted` and has
    **not** been read. This is a *diagnosis* step, not a fix, and it is where
    this entry now stops being able to help without one.
  2. **Compare it against the id a dev-login operator actually gets.** M20's
    retro is what makes this the leading hypothesis: the variable takes
    `users.id` **verbatim** — `google-<sub>`, never an email — comma-separated
    and not a JSON array, injected at deploy time, and *"it fails closed on
    every one of those, which is why a mistake looks like silence."* A value
    listing a real Google id is right for production and useless on a preview,
    where `e2e/adminBootstrap.ts` grants through a `dev-` identity.
  3. **Only then** decide whether the fix is a value change, an added id, or
    something else entirely.

  **Stated as a hypothesis on purpose.** Step 1 has not been done, so "the value
  is wrong" is the most likely explanation and not a finding. The previous
  sketch was written with the same confidence and was wrong, which is the
  argument for reading before prescribing.

  - Alternative without a deploy, unchanged and still untested: flip the
    `admin-console` flag for a dev account, which needs dashboard access.
  - Worth recording in `docs/guidelines/environments-and-deploys.md` beside the
    `ADMIN_USER_IDS` row once decided.
- **What was verified on 2026-09-19, and what was not.** Both variables are
  *bound* to their environments — `ADMIN_USER_IDS` to preview and production,
  `API_TOKEN_PEPPER` to preview, development and production. **Binding was
  confirmed; content was not.** Vercel's env listing returns
  `decrypted: false`, and a `sensitive` variable's value is never returned at
  all, so a variable set to an empty string would look identical. Nothing here
  establishes that any of these values is correct — only that the variables
  exist.
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
