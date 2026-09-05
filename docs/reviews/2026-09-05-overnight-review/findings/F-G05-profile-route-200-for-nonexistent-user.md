# F-G05 — `GET /api/playbooks/profile/[userId]` returns a plausible 200 profile for a user id that does not exist

- **Stream:** G Broken functionality · **Severity:** LOW · **Confidence:** CONFIRMED (live)
- **Area:** `apps/web/src/server/playbooks.ts:487-501` (`publicAuthor`: an aggregate over zero rows still yields one row, so the `row === undefined` branch at `:499` is dead; no `users` lookup; the name is minted by `displayNameFor` → `lib/displayName.ts:53` → `handleFor(userId)`); route `apps/web/src/app/api/playbooks/profile/[userId]/route.ts:27-61`.
- **What is wrong:** `/playbooks/profile/not-a-user` renders "Traveler tauser — 0 days shared — Nothing shared yet". Stream A read this as "no enumeration" (a zeroed author, not a 404), which is a fair security property, but a nonexistent person is not a person with nothing shared, and the derived-never-authored name rule makes it look real.
- **Reproduction:** signed in, `curl /api/playbooks/profile/anything` → 200 `{"author":{"userId":"anything","displayName":"Traveler …"}}`.
- **Suggested fix:** one `users` existence check → 404; keep the zero-days profile for real users. If the anti-enumeration property is wanted instead, say so in the route comment so the next reader does not file this again.
- **Scope of the fix:** `playbooks.ts` + route. Check subset: `apps/web/src/app/api/playbooks/*.int.test.ts`.
- **Test that should exist:** profile for a random id → 404 (or a comment recording the deliberate 200).
