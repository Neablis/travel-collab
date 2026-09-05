# ADR-040 — A kept day is a snapshot, and the flag reports provenance

**Status:** Draft, for review. Nothing here is built. The three decisions below
are proposals with a recommendation each; Decision 2 has a cheaper fallback
that is worth arguing about before anyone writes a migration.

**Depends on:** ADR-028 (lineage, and who may clone), ADR-029 (a saved day is a
personal, private, dateless fragment).

## Context

Timeline's day header carries the keep-a-day pennant. As of the commit that
precedes this ADR it plays the design's full `celebrate()` choreography on a
save — the spring, the brand fill, the "Kept" pill, the ring, the sparks.

Then it goes back to a neutral circle, and the design says it should not. The
design has three flag states, not two:

| state | look | title |
|---|---|---|
| `data-kept="0"` | surface circle, hollow pennant | "Keep this day as a Playbook" |
| `data-kept="2"` | the 2.6s celebration | — |
| `data-kept="1"` | **solid brand, filled pennant, at rest** | "In your Playbooks — edit or share" |

State `1` is not built, and it is not a styling gap. It asks a question the
schema cannot answer: **is this day kept?** `SavedDay` records `sourceTripId`
and `sourceTripName` (ADR-029, on ADR-028's snapshot terms) but no
`sourceDayId`. `CreateSavedDayInput` takes a `dayId`, the server reads the day
through it, and then discards it. After a reload nothing links a Playbook back
to the day it came from.

The obvious fix — add `source_day_id` — is necessary and **not sufficient**,
for two reasons that are the whole reason this is an ADR and not a migration.

### A kept day is a snapshot, and the trip day keeps moving

ADR-029 Decision 1 makes `stops` a jsonb **value**: copied whole at save time,
copied out whole at insert time, never queried into. That is deliberate and
this ADR does not reopen it.

The consequence is that the two things the flag would sit between are not the
same object and are not kept in step. The day in the trip goes on being
planned — stops added, times moved, a hotel swapped. The Playbook is the day as
it stood at 9:14pm on a Tuesday. `source_day_id` alone would let the pennant
say "kept", but what it would actually mean is *"a snapshot was taken from here
once"* — an assertion that starts true and decays silently. A green flag on a
day that has been rewritten since is worse than no flag, because it invites
someone to skip re-keeping a day that no longer matches what they saved.

This is the "draft in the day vs what's published in the Playbook" problem, and
it is a real split, not an implementation detail.

### Re-keeping must not mean twenty near-identical Playbooks

Today every save is an insert. Keep Day 5, tweak a stop, keep it again, and the
library holds two Playbooks with the same name and nearly the same content.
Nothing stops that reaching twenty. A library that fills with drafts of one day
is not a library, and the cost lands on the person who owns it — Playbooks are
private today, so they are the only one who ever sees the mess.

## Decision 1 — store `source_day_id`, and treat it as provenance

Add `source_day_id` to `saved_days`, nullable, and to the `SavedDay` contract.
Nullable because existing rows have no answer and never will, and because a
Playbook is not required to have come from a trip day at all.

It is **provenance, not a foreign key with meaning**. Exactly like
`source_trip_name` in ADR-028's reading: it records where a value came from and
survives the source changing, being deleted, or becoming unreadable. Nothing
reads through it to fetch live data. A dangling `source_day_id` is not an
error — it is a day that was deleted, and the Playbook is still perfectly good.

## Decision 2 — the flag has three states, not two, and drift is shown

**Recommended.** Store a content digest of the stop value alongside the
snapshot — the same value ADR-029 already treats as an opaque whole, hashed
once at save time. The flag then reads:

| meaning | look |
|---|---|
| no Playbook came from this day | neutral circle |
| the canonical Playbook from this day still matches it | the design's `data-kept="1"` |
| the day has moved on since that snapshot | kept, marked as drifted |

The third state is the one that earns the digest. Without it the flag has to
choose between two lies: claim freshness it cannot check, or drop the resting
state entirely and pretend keeping a day leaves no trace. The tooltip carries
the difference in words — "In your Playbooks — edit or share" against something
like "In your Playbooks, from an earlier version of this day".

The digest is over the same jsonb value that is already copied whole, so this
adds no querying into `stops` and does not weaken ADR-029's boundary. Which
snapshot it is compared against, when a day has produced more than one, is
settled in Decision 3.

**Cheaper fallback, if the third state is judged not worth a column:** two
states, where the resting flag means only *"a Playbook came from this day"* and
the tooltip says exactly that, making no claim about freshness. It is honest.
It is also less useful, and it makes Decision 3's "update" harder to explain,
because the person cannot see that there is anything to update.

**Open question for review:** three states with a digest, or two without.

## Decision 3 — re-keeping a day updates its Playbook by default

When a day already has a Playbook, the keep dialog's primary action becomes
**Update "<name>"**, with **Save as new** demoted to a secondary. Saving a
second Playbook from one day stays possible; it stops being the path of least
resistance.

**Which Playbook, when a day has several.** "Save as new" means `source_day_id`
can match more than one row, so both the update target and the flag's state
would otherwise be undefined (Copilot, PR 142). The rule: **the most recently
created Playbook from that day is the canonical one.** It is what Decision 2's
digest is compared against, it is what **Update "<name>"** targets, and taking
"Save as new" makes the new row canonical from that moment.

Most-recent rather than, say, "any matching snapshot wins" because the flag has
to name one thing in its tooltip and offer one default action, and because the
alternative has a bad failure mode: a stale Playbook that happens to match a
day the person has since reverted would show green while the copy they actually
work from sits drifted and unmentioned. Deterministic and boring beats clever
here. It does mean the flag can read "drifted" while an older Playbook from the
same day still matches exactly — an acceptable trade, and a reason the
Playbooks surface (not the flag) should be where all of a day's snapshots are
visible.

**Why updating in place is safe today, specifically.** ADR-029 Decision 1 says
an insert copies the value *out* whole. Someone who already added this Playbook
to their trip holds their own copy there — updating the Playbook does not reach
into their plan and change it. The adds ledger counts the add that happened,
and that stays true. Combined with Decision 3 of ADR-029 — saved days are
private — an update today is visible to exactly one person: the owner, who
asked for it.

**And exactly when that stops being true.** Once Playbooks become public,
rateable and shareable (DRIFT D9, M12 Community), an update mutates an artifact
other people have reviewed and ranked, and "4.8★, shared 214 times" would no
longer describe the thing on the page. At that point identity and version have
to come apart, and update-in-place must become publish-a-new-version. **This
ADR is to be revisited as part of M12, before anything makes a Playbook
public** — not after.

## Consequences

- A contract change (`SavedDay`, plus `CreateSavedDayInput` if the update path
  needs to name a target) and a migration. Per AGENTS.md Invariant 5 this goes
  through the contract protocol and `docs/contracts/CHANGELOG.md`, not drift.
- Reading kept state needs the day ids for a trip on the trip-detail read path.
  A set of `source_day_id`s for one trip's Playbooks is a single indexed query
  and does not touch `stops`.
- The pennant becomes a control with a resting state that means something, so
  it needs its own empty/error behaviour: unknown state should render as
  neutral rather than as "kept", since a false negative costs a redundant save
  and a false positive costs a lost edit.
- The celebration built ahead of this ADR ends on the neutral circle. When
  state `1` lands, the last frame of `celebrate()` should hand off to it rather
  than animating back — the design's own `fill: 'forwards'`.
- KI/DRIFT: `keep-day-flag` stops being listed as blocked on a feature and
  becomes blocked on this ADR's migration, until it lands.

## What this ADR does not decide

- Whether a Playbook can be edited directly, independent of any source day.
  The design's tooltip says "edit or share", which implies yes; that is a
  separate surface and a separate decision.
- Anything about public Playbooks, reviews, ratings or the leaderboard. That is
  M12, and it is the trigger for revisiting Decision 3, not part of it.
