# M11a — An invite gate on the front door

**Status:** Scoped and placed **2026-08-30** by Mitchell, in the same session
that scoped M11b. Phase 2, running **after M17 and before M11b**.

**Opened by:** Mitchell, 2026-08-30, on M11b's precondition — *"Can we add a
very basic invite code today? when trying to sign in and never been to app, you
need a invite code?"* — and then, on seeing the shape: *"Dont build it yet, roll
it as work to do before the playbook work from the designs."*

**Numbered `M11a` as a stable name, not a position.** M11 shipped invites and
the `users` table, M11a gates who gets an account at all, M11b makes Playbooks
public — one access family, in the order they are built. Same
placement-not-renumbering convention as ADR-018/021/022 and M18b.

## Why this exists

M11b publishes **user-authored free text** — stop titles and per-stop notes — on
public routes, and **M12 keeps reviews and moderation**, so there is no
reader-facing report path until M12 lands. That split rests entirely on
Mitchell's 2026-08-30 reasoning:

> *"We will gate on who we invite to platform, we dont need reviews shipping
> first, we need a community before its a issue."*

That is sound — moderation tooling built for a population that does not exist is
tooling built against a guess. But **the gate it names does not exist**: any
Google account that reaches `/signin` gets one today, and the landing page's
"Early access" line (`LandingScreen.tsx:122`) is copy about *trip* invites, not
signup. This milestone builds the gate, so that M11b's scope split rests on a
control rather than an intention.

**It runs before M11b and not after.** Publishing must not go live on an open
signup while the plan of record says the population is invited.

## The shape of the problem — most of it is already built

This is a small milestone because the two things it needs already exist, and
neither was built for this:

- **`users` (M11 link 1, ADR-025) is already the record of who has been here.**
  So *"never been to the app"* is exactly *"has no `users` row"* — no new
  concept, no new state, and every existing account passes automatically.
- **The `signIn` callback is already a fail-closed boolean.**
  `server/auth.ts` composes it from `server/users.ts`'s `recordSignIn`, whose
  own comment reads *"deliberately fail-closed on both paths, because the point
  of the table is that no session can exist for a person who has no row."*
  Returning `false` lands on the designed `/signin?error=` screen, which already
  has a copy map (`authCopy.ts`). Adding *"…or who has no invite"* is the same
  sentence in the same function.

Two more seams are already in place: `proxy.ts` already matches `/invite/:path*`
and already redirects a signed-out visitor to `/signin`, and
`access/invites.ts`'s `acceptInvite` already demonstrates the
conditional-update-under-race construction a single-use code needs.

**The one genuinely fiddly part is that OAuth leaves the site.** A code cannot
be collected inside the callback — by then the browser has been to Google and
back. It has to be captured *before* the redirect and carried across it.

## Scope

**Three ways through the gate, evaluated only when there is no `users` row.**
Both storage choices below are Mitchell's, 2026-08-30 — he asked for both, not
one: *"i want a super code i can share that gets you invite, and unique codes
that are one-off."*

**Link 1 — The admission rule, in one module.** `server/admission.ts`. Called
twice: once from the signup form for immediate "that code isn't valid" feedback,
once from `recordSignIn` as the authoritative validate-and-redeem. The rule is
written once even though it is asked twice.

**Link 2 — A trip invite is an invitation.** Mitchell's explicit call,
2026-08-30: holding a **pending, unrevoked** M11 invite token admits you with no
code. The token was issued by someone already inside, is scoped and revocable,
and carries the same trust a code does. Without this, inviting someone to a trip
would take two steps and M11's invite→accept→edit flow would break for exactly
the new collaborators it exists to bring in.

**Link 3 — A reusable super code.** One value in the environment, multi-use, no
row. For people being onboarded actively, where handing out a single shared
string is the whole point.

**Link 4 — Single-use codes.** An `invite_codes` table — code, created,
`redeemed_by`, `redeemed_at`. Redemption is a conditional
`UPDATE ... WHERE redeemed_by IS NULL`, so two people cannot race the same code.
This is what makes it an invite system rather than a shared password: a leaked
code burns once, and you can see who came in on whose invitation. Needs a
migration.

**Link 5 — Carrying the code across the OAuth round trip.** One cookie,
`pending_admission` — httpOnly, `SameSite=Lax`, short TTL — set before the
browser leaves for Google, read and **cleared** in `recordSignIn` on both
success and refusal. Two things fill it: the code field on `/signup`, and
`proxy.ts` storing the token when a signed-out visitor hits `/invite/<token>`.
The proxy **stores, it does not validate** — it runs in the Edge runtime with no
database, and validation belongs in the one module that owns the rule anyway.

**Link 6 — The refusal is a designed screen, not a stack trace.** New copy in
`authCopy.ts` for a missing, wrong and already-redeemed code, each saying what
to do next. Project rule 6: this is the failure state of the front door.

## Explicitly not here

- **Any per-user invite allowance or quota.** Considered and declined
  2026-08-30 — it needs a second table and a second set of rules, and the point
  of this milestone is a gate, not an economy.
- **Reporting and moderation.** Still M12's, and this milestone is what buys the
  time to leave it there.
- **Account settings, preferences, display names** — M17's, and M17 runs first.
- **Invite-code administration UI.** Codes are minted by hand for now. If that
  becomes the bottleneck it earns its own scope; it is not on the path to M11b.

## Exit gate

- [ ] A brand-new Google account with **no** admission is refused, lands on the
      designed `/signin?error=` screen with copy that says what to do, and
      **leaves no `users` row behind**.
- [ ] **All three admission paths admit a genuinely new account** — a pending
      trip-invite token, the super code, and a single-use code — each **walked
      in a browser**, not only unit-tested. The OAuth round trip is the part
      that cannot be asserted from a unit test.
- [ ] A single-use code is **single-use**: a second sign-in with it is refused,
      and two concurrent redemptions produce **exactly one** admission. Proven
      against the row, not the UI.
- [ ] **Every existing `users` row signs in unchanged, with no code** — proven
      for an account that existed before the gate shipped. Nobody already here
      gets locked out, Mitchell included.
- [ ] **M11's invite→accept→edit flow still works end to end for a person who
      has never signed in.** This is the regression the gate most threatens, and
      it is the flow M11's own gate walked as two actors.
- [ ] The `pending_admission` cookie is httpOnly, `SameSite=Lax`, short-lived,
      and **cleared on both success and refusal** — no admission credential
      outlives the sign-in that used it.
- [ ] **Dev-login does not bypass the gate by accident.** Either it goes through
      the same admission path or its exemption is explicit and env-gated, and
      the e2e lane states which. `isDevLoginEnabled()` already gates the
      provider; that is not the same as gating admission.
- [ ] **The `invite_codes` migration is written, applied locally, and its
      production dispatch is called out in the PR body** —
      `gh workflow run migrate-production.yml -f confirm=migrate` from `main`.
      Merging does not apply a migration.
- [ ] `pnpm --filter web test:e2e:ci-like` green **twice against a production
      build**, plus the browser walk above. A suite pass is not the gate.

## Prerequisites and traps

- **M17 closes first**, per the placed order. Nothing here depends on it; it is
  sequencing, not a dependency.
- **Rotating the super code needs a redeploy.** Vercel injects environment
  variables at build, so changing the value does not take effect until the next
  deployment. That is the practical argument for minting single-use codes for
  most people and keeping the super code for active onboarding — and a reason
  not to treat the super code as revocable in an emergency.
- **Only two places in the e2e suite actually sign in** — `auth.setup.ts` and
  `smoke.spec.ts`; every other spec reuses saved storage state. The blast radius
  is small, but it is not zero, and `auth.setup.ts` runs before every project.
- **`server/admission.ts` must not be imported from `proxy.ts`.** The proxy
  builds its own Edge-runtime Auth.js instance from `lib/authConfig.ts`
  precisely so no database reaches it (ADR-024). The cookie write is Edge-safe;
  a validation call would not be.
