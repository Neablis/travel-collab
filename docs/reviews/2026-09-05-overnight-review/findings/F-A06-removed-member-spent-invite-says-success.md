# F-A06 — A removed member's spent invite link still answers "success" with a role they do not hold

- **Stream:** A Security · **Severity:** LOW (UX-correctness, not privilege gain) · **Confidence:** CONFIRMED (verified; cites corrected)
- **Area:** `apps/web/src/server/access/members.ts:247-254` (`removeMember` → `revokeMembership` deletes `trip_memberships` only; owner check at `:252`); `access/invites.ts:250-252` (accept fast path returns `{ ok, tripId, role }` when `status === "accepted" && acceptedBy === userId`, *before* the membership check at `:274-279`); `previewInvite` (`:199-209`) correctly says "already been used".
- **What is wrong:** `DELETE /members/:userId` leaves the admitting `trip_invites` row `accepted`. The removed person re-opening `/invite/<token>` gets a preview saying "used" but `POST /accept` says `ok` with a role — then 403 on the trip. The two endpoints disagree; no membership is granted (the transaction path claims only `pending`, `:290`).
- **Suggested fix:** in `removeMember`, also set `status = 'revoked'` on invites with `acceptedBy = userId` for that trip (mirrors `revokeInvite`'s coupling in the other direction); or make the fast path verify membership first.
- **Scope of the fix:** `members.ts` (+ possibly `invites.ts`). No contracts, no migration. Check subset: `invites.int.test.ts`, `members.test.ts`.
- **Test that should exist:** accept → remove → re-accept returns `invalid`/`gone`, not `ok`.
- **Cross-reference:** KI-065 (resolved; introduced `removeMember`).
