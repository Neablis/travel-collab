# M44 — A stop knows what was booked, and what it sits inside

**Status:** **Proposed 2026-10-06, placed after M43. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

Two entries ask the activity contract to say something it cannot say today. Both are changes to
`packages/domain` and to event payloads that are replayed forever (invariants 1 and 2). Doing them
in one milestone means one contracts review, one public API minor version and one migration
window.

- **Booking details.** An external API consumer keeps confirmation numbers in `notes`. Mitchell
  chose, on 2026-09-30, not to adopt a notes convention, because parsing free text is fragile and
  gives API callers nothing typed. The shape if it comes: `booking: { confirmation?, provider?,
  url? }`.
- **Containment.** A lunch inside a day-long museum visit raises `time-overlap`, and every day of
  the Rochester run did (2026-08-02). *"three warns on a three-day trip is the AI teaching users to
  ignore the conflict UI"*.

Candidates absorbed (each deleted by this gate):
- *Structured booking fields on a stop: confirmation number, provider, link* (2026-09-30)
- *Contained activities: a meal inside a day-long activity is not a conflict* (2026-08-02)

## Decisions it needs (recommendations; none answered)

1. **`booking` is an optional object on the activity**, set and cleared through the existing
   update command. It is additive, and the public API gets a minor version.
2. **Who can see a confirmation number.** *Recommended:* members with at least editor access, and
   never through share links (`/s/**`) or published playbook days. A viewer sees that a stop is
   booked, not the code.
3. **Check-in and check-out times stay in the time window**, not in `booking`.
4. **Containment is rule (c), not new structure.** *Recommended:* in `conflicts.ts`, suppress
   `time-overlap` when one window fully contains the other and the inner stop is at most a set
   length (say 2 hours) or is a `meal`-tagged stop. Nested activities, option (a), stay out until
   containment needs to mean more than silencing a warning. The entry names (c) as the cheapest
   option, and nothing so far has asked for more.

## Scope

- `booking` across the contract, the domain, the editor, the card, the Money notebook's booked
  list, the public API and trip export (M25).
- The containment rule and its property test.

## Out of scope

- Parsing confirmation emails.
- Nested activities.

## Exit gate

- [ ] **Decisions 1–4 are answered and recorded here**, with the contracts changelog entry.
- [ ] **A trip replayed from a log written before the change equals its stored projection**, which
      a test shows, because old events carry no `booking`.
- [ ] **A confirmation number never reaches a share link or a published day**: an integration test
      reads both.
- [ ] **A short stop inside a long one raises no overlap**, and a partial overlap still does.
      Shown by a `fast-check` property, seen red with the rule removed.
- [ ] **The Rochester-shaped fixture produces no `time-overlap` warnings.**
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: add a booking, see it on the
      card, open the share link, and see no code.
- [ ] A retro is appended at gate close.
