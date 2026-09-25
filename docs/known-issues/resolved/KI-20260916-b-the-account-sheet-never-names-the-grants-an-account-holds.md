### KI-2026-09-16-b — the account sheet never names the grants an account holds, so a granted plan reads as the free one — RESOLVED

- **Severity:** product clarity (nothing is computed wrongly; the screen cannot explain a correct answer, and the correct answer looks like a bug)
- **Area:** `apps/web/src/server/entitlements/accountPlan.ts` (`AccountPlanView` — no `grants` field), `apps/web/src/components/account/PlanSection.tsx:191` (`data-testid="plan-held"`)
- **Symptom:** an account holding `free@v1` with an admin `premium` grant and a `founder` grant renders **`free v1`** as the only tier the screen names. Reported from a preview walk, 2026-09-16: *"I think the mapping of tier name to actual tier is broken. I granted this one premium, and its grandfathered into founder, but it shows free.v1."*
- **Why it is not a mapping bug:** `plan-held` renders `planVersionRef`, which is `users.plan_id` — what the account **holds**. A grant does not move an account onto a tier, and `accountPlan.ts:264` says so in as many words. The resolver already does exactly what the report asks for: `resolveEntitlements` is *"a union with no precedence and no 'highest wins'"* (`resolver.ts:141`), `ceilings` is `mostGenerousCeilings` over held-plus-grants, and `PlanSection` already tells the reader the meters are *"the most generous of {plan} and anything granted to you"*. Two tiers at once, union of both, no subtraction, is the implemented model — M20's *The shape*.
- **What is actually missing:** `AccountPlanView` puts `planVersionRef`, `conferredVersionRef`, `entitlements`, `catalogue` and `billing` on the wire, and **no grants at all**. So the sheet can say what you hold and what you can do, and is structurally unable to say *why you can do more than you hold*. The effective set appears only as an unattributed `You can: …` sentence. A `founder`/`admin`/`referral` grant is invisible on the one screen whose job is to explain the account, which is what made a correct render read as a broken one.
- **Not verified, and it decides the severity:** whether the reporting account's effective union actually includes `premium`'s entitlements. The discriminator is the sentence directly under the tier line. If it lists premium's capabilities, this entry is right as written. If it reads *"Planning only — the assistant and collaborators are not on this plan."*, then the grants are not resolving for that account and that is a **different and much worse defect** than this one — file it separately rather than widening this.
- **Fix path, if taken:** put the live grants on `AccountPlanView` (source, planId, version, `expiresAt`) and render a row naming them under the held line — *"plus premium@v1 (admin, permanent) and founder@v1"*. The data is already loaded: `entitlementsFor` returns `grants` on `AccountEntitlements` and `accountPlanView` drops it on the floor. Wording belongs with SPEC §29's account-sheet copy, since the same row has to read sensibly for a trial grant, which today is described only by the `Free week` badge.
- **Cross-reference:** M21 (`docs/milestones/M21-subscriptions-and-billing.md`), M20's grant model, `resolver.ts`'s `resolveEntitlements` header, `entitlementsLostIfSubscriptionStops` (the other place a grant's invisibility was already found to be expensive — CodeRabbit, PR #177).
- **First noted:** 2026-09-16, on a preview walk of PR #184's deployment. Not that PR's code: #184 is M9's assistant build and touches nothing in `entitlements/` or `components/account/`.
- **Partly closed before this fix, by #195 (2026-09-19).** That PR put
  `grantedVersionRefs` on the wire and made the headline tier the best one a
  grant confers (`effectiveTierRef`), so the literal symptom — `free v1` as the
  only tier named — was already gone. What it did not do is the part this
  entry's *What is actually missing* describes: name the grants themselves.
- **RESOLVED 2026-09-25, by the fix path above.** `AccountPlanView` gains
  `grants: { planId, version, source, expiresAt }[]` (server
  `PlanGrantView` in `server/entitlements/accountPlan.ts`, mirrored as
  `AccountGrantView` in `lib/accountPlan.ts` and pinned by
  `accountPlanWireShape.test.ts`); `accountPlanView` maps it from the
  `resolved.grants` it already loaded. `PlanSection.tsx` renders one row,
  `data-testid="plan-grants"`, under `plan-held`, from `grantsSentence` in
  `lib/planCopy.ts`. No `packages/contracts/src` change.

  **Reproduction, before and after.** A scratch component test rendered the
  reported account (`free@v1`, admin `premium@v1`, founder `plus@v1`) against
  the unfixed sheet. The card's whole `textContent` was `premium v1FreeYou
  bought free v1; a grant on this account confers premium v1.You can: ai.ask,
  ai.command, trip.collaborators.Change plan`, and the probe printed
  `names 'founder': false | names 'admin': false | names 'plus': false`. After: the card adds `Granted to you: premium v1 (admin,
  permanent) and plus v1 (founder, until December 1).` New cases in
  `PlanSection.test.tsx` (`the grants on an account`, three tests) and a new
  `server/entitlements/accountPlan.int.test.ts` (real grants through the real
  resolver). Seen red for this reason each: sheet fed `[]` instead of
  `plan.grants` → `Unable to find an element by: [data-testid="plan-grants"]`
  (2 failed); trial de-duplication off → `Expected: "Granted to you: plus v1
  (free week)." Received: "… (free week, until September 22)."`; server
  mapping with `expiresAt: null` → `AssertionError … "expiresAt": null`.

  **Checks run** (narrow subset; `apps/web` only, no contracts file touched):
  `pnpm --filter web typecheck` clean; `eslint --max-warnings 0` on the nine
  touched source files clean; `vitest run -c vitest.unit.config.ts` on
  `PlanSection.test.tsx`, `PlansScreen.test.tsx`, `planCopy.test.ts`,
  `accountPlanWireShape.test.ts` and `src/components/assistant` (the account
  plan mock's consumers) — 16 files, 263 tests green;
  `node scripts/with-test-db.mjs vitest run src/server/entitlements/accountPlan.int.test.ts`
  green.
- **Decision (2026-09-25 overnight sweep):** the row reads `Granted to you:
  <plan> v<n> (<source>, <term>)`, joined as an English list, where source is
  the operator console's own *why they hold it* word (SPEC §17.2: `admin`,
  `founder`, `referral`) except `trial`, which is `free week` to match the
  state badge (§17.4); term is `permanent` for a null expiry and `until
  <date>` otherwise, except that a free week's date is dropped while
  `plan-trial-ends` already prints it. The row is absent when there are no
  grants. Rejected: customer-softened source words (`comped by us`,
  `founding member`), because they would name the same grant differently on
  the console and the sheet; folding the grants into the existing `plan-held`
  sentence, because that line already carries the bought-versus-conferred
  contrast and a third clause made it unreadable; replacing
  `grantedVersionRefs` with the new field, because `effectiveTierRef` and its
  tests read it and removing it would widen this change for no reader.
