# F-A04 — Every member's email crosses the wire to any viewer, and nothing renders it

- **Stream:** A Security · **Severity:** LOW · **Confidence:** CONFIRMED (verified; cites corrected)
- **Area:** `packages/contracts/src/access.ts:58-64` (`TripMemberProfile.email`); `apps/web/src/server/access/members.ts:265-278` (`withProfiles`, `email: profile?.email ?? null` at `:275`); served by `app/api/trips/[tripId]/access/route.ts:23-27` (viewer-minimum) and `members/[userId]/route.ts:64-70`; the only `.email` render anywhere in `components/**` is `TravelersPanel.tsx:189` (`invite.email`, owner-only).
- **What is wrong:** with link-bearer invites (ADR-026: email is "a label, not a check") and `INVITE_SUPER_CODE` sign-ups, a viewer can be a stranger, and they receive every traveller's email address in a field the UI never uses.
- **Suggested fix:** drop `email` from `TripMemberProfile` (contract change + CHANGELOG), or populate it only when `access.role === "owner"` alongside the invites list.
- **Scope of the fix:** `access.ts`, `members.ts:withProfiles`, both routes, any consumer of the type. Check subset: contracts touched → `pnpm check`.
- **Test that should exist:** a viewer's `GET /access` response has no `email` key.
- **Do not:** filter in the route — the contract is where the public surface is decided (the `sharedView.ts` pattern).
