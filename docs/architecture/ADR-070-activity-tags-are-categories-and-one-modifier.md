# ADR-070: Activity tags are twelve categories and one modifier, and a trip's description is derived from them

**Status:** **Accepted — 2026-10-11.** Mitchell, in session scoping M42.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-054** (three kinds; *a tag is what a stop IS*: this keeps that line and widens
the vocabulary), **ADR-041** (content bundles import `ActivityTag`, so new tags reach them with no
schema edit), **ADR-039 / ADR-057** (a widget's tag filter takes one value), **KI-052** (four tags
shipped where the design had six: superseded by this ADR), milestone
`docs/milestones/M42-the-front-door-shows-more.md` (D5–D11).

## Context

`ActivityTag` is `meal | lodging | ticketed | outdoors` (`packages/contracts/src/activity.ts`).
It is a closed enum on purpose, and a stop may carry several. Two things were wrong with it.

- **It cannot describe a trip.** Four tags, two of them near-universal (every trip eats and
  sleeps), cannot tell a nightlife weekend from a museum week. Bundled content shows it: across
  the four trips and nineteen playbooks, almost every tag is meal, outdoors or ticketed.
- **`ticketed` is not a kind of activity.** It is a property that a museum has and a market does
  not. Since M28 it drives nothing (`needsBooking` keys on `kind === "pending"`); it is a label.

Mitchell wants the tags to describe what an activity is, so the app can say what a trip is like,
search engines get tag pages, and notebooks can chart the mix.

## Decision

1. **Thirteen tags: twelve categories and one modifier.**

   | Key | Label | Role | Covers |
   |---|---|---|---|
   | `meal` | Food | category | restaurants, street food, food halls |
   | `lodging` | Lodging | category | where you sleep |
   | `ticketed` | Ticketed | **modifier** | needs a ticket or booking to enter |
   | `outdoors` | Outdoors | category | hikes, parks, gardens, viewpoints you walk to |
   | `drinks` | Drinks | category | bars, cafés, wineries, tastings |
   | `nightlife` | Nightlife | category | clubs, late venues, night markets after dark |
   | `museum` | Museum | category | museums and galleries |
   | `sight` | Sight | category | landmarks, temples, monuments, viewpoints |
   | `beach` | Beach | category | beaches, swimming, coast |
   | `shopping` | Shopping | category | shops and markets |
   | `show` | Show | category | performances, sport, events |
   | `tour` | Tour | category | guided tours and classes |
   | `wellness` | Wellness | category | spa, onsen, yoga |

   - **Existing keys are never renamed or removed**: stored events, trip documents, saved days and
     page filters parse with the strict enum, and the public API treats a removal as major. A
     label can change (`meal` reads *Food*).
   - **New keys are appended after the existing four.** Spend charts file a multi-tag stop under
     its first tag in contract order, so appending moves no existing stop's spend.
   - The picker shows two groups: *What it is* (the twelve categories in M42 D5's order: Food,
     Drinks, Nightlife, Museum, Sight, Outdoors, Beach, Shopping, Show, Tour, Wellness, Lodging) and
     *Needs* (Ticketed). Toggling keeps contract order, because
     `sameTags` compares in order.
   - Adding the nine keys is an additive change: `API_VERSION` minor, and a CHANGELOG entry.

2. **The modifier is left out of everything that describes or charts categories**: descriptions,
   tag pages, the Discover tag filter, and the tag widgets. A stop whose only tag is Ticketed
   counts as untagged there.

3. **A description is derived, at read time, from the share of stops.** One pure function in
   `@tc/domain` describes a trip or a day from its stops; nothing stores the result (a query may
   materialise it for filtering, recomputed on every write, but the function is the only rule).
   - Count stops with at least one category tag, ignoring Lodging and Ticketed.
   - **Food** qualifies when at least **50%** of those stops are Food: every trip eats, so the
     bar is higher.
   - Any **other category** qualifies when it is on at least **25%** of the stops that carry a
     non-Food category **and on at least two stops** (amended 2026-10-11, part 3: otherwise a day
     of four meals and one bar reads "Drinks & food", the bar being 100% of the non-Food stops).
   - The top two that qualify, by share, name it: one gives an adjective ("Outdoorsy"), two give
     a pair ("Beach & outdoors", "Food & drink"). None gives *"A bit of everything"*.
   - Below a minimum number of tagged stops, there is no description, rather than a misleading one.
   - The copy for each tag (adjective and noun) is a table beside the function, tested so every
     category has both.

4. **A day belongs to a tag when the tag is in its description.** That is the membership rule for
   `/playbooks/tag/<tag>`, `/playbooks/city/<slug>/<tag>` and the Discover tag filter, so a day
   with one bar on it is not a nightlife day. A tag page is indexed, and in the sitemap, only with
   at least `MIN_INDEXED_PLACE_DAYS` (3) days.

5. **Only bundled content is re-tagged**, once and offline, reviewed as a JSON diff. Users' trips
   are not rewritten; the assistant's tools take the enum from the contract, so it tags new stops
   with the new vocabulary without a prompt change.

## Consequences

- KI-052 (the design's six tags, shipped as four) is superseded and resolved by M42 part 1.
- `docs/features/stop-kind-and-tags.md` is rewritten for three kinds and thirteen tags.
- Every `Record<ActivityTag, …>` (labels, chip classes, spend colours, fixture expectations) must
  grow, and the compiler says where. Hard-coded lists that do not fail to compile — the picker
  order, the spend-by-tag preset's text, the simulated model's topic regexes, the M18 contract
  test — are named in the plan.
- The chart palette must carry twelve category series that stay distinguishable in both themes.
- Free-text or user-defined tags remain out: the closed set is what makes pages, charts and
  descriptions possible.
