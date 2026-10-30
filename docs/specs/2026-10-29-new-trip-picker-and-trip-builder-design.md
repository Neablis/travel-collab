# New trip: a picker for everyone, a trip builder for paid plans, and an AI that never strands you

**Status:** Design, 2026-10-29. Direction approved by Mitchell in the session that wrote it
(screens: the "New trip: guided + AI" design canvas from that session). **Became M56 on
2026-10-30** (`docs/milestones/M56-new-trip-is-a-picker.md`, ADR-084). §8's decisions are
answered there; **D1 changed to *create first***, so §2, §4, the builder half of §5 and §9's parts
4, 6 and 7 are superseded: there is no pre-trip builder, `TripDraft` or `new-trip` surface.

Mitchell's asks, in order:

> It was really surprising when i tried to type rather than click a pre-given option i got this
> experience

(He typed *"I am not sure, can you help me plan a real foodie adventure? Somewhere i havent been
before, 2 weeks long"* into the destination turn. Cass replied *"I am not sure, can you help me
plan … 2 weeks long, good. Do you have a start date in mind?"*.)

> I picture a flow where you "Pick" in the ai agent multi picker, or date picker, or box
> deterministically the entire time till the end, then you (if your a free user) get the trip,
> and if your a paid user have the option to keep planning with AI.

> Lets just make sure we really think through the tool calls for the AI agent to help you plan a
> trip, what widgets the agent needs to ask user questions, show responses, etc. At some point
> need a clear vision how to go from "chating with assistant" to "Create the trip" and go to the
> plan page to allow follow ups.

> The worst thing we can do is make the user feel stuck talking to a ai agent that doesnt have
> the tools to do the task, but doesnt understand that

**How far to trust §1.** Read from `main` at `1c79d40` in this session. Paths are under
`apps/web/src/` unless they start with `packages/` or `docs/`.

---

## 1. Where things stand

**The New-trip sheet looks like a chat and is a form.** `components/home/newTripScript.ts` is a
fixed script that makes no model call by design (SPEC §30.2). Typed text on the destination turn
is committed verbatim as `answers.where` (`commitAnswer`), echoed as `"${answer}, good."`
(`acknowledge`) and becomes the trip's name (`NewTripWizard.tsx:454-466`). Typed text on the
date, length, pace and *about* turns is stored and never read; only chips and the day picker
produce data. A start date picked with a typed (non-chip) length is also dropped, because `dated`
requires a day count (`NewTripWizard.tsx:480`). Pace and *about* reach nothing: the closing line
says so (*"not built in yet"*).

**The assistant is scoped by surface.** `server/assistant/grants.ts` `SURFACES` grants each
surface a cap per tool domain. `trip` and `day` may propose itinerary and library changes;
`account` (Home) may only read; the playbook pages may propose taking a playbook into a trip.
Changes are proposals the person approves (ADR-022, ADR-067); nothing in the agent loop writes.

**The assistant already has the parts of a hand-off, but no way to start a trip from scratch.**
- `start_trip_with_playbook` (`tools/playbook.ts`) proposes a **new trip** with
  `target: { kind: "new-trip" }` (`packages/contracts/src/assistant.ts`, `AssistantProposal`).
- `open_trip` and `go_to` (`tools/navigate.ts`) move the person, by naming palette commands
  (ADR-072), never URLs.
- `request_change_tools` (`tools/escalate.ts`) lets a turn that was read-only ask for the change
  tools when it misjudged the request.

**Home is where people get stranded today.** The account turn's instruction says *"You can READ
and nothing else … if you are asked to [change a trip], say plainly that changes are made inside
a trip"* (`ai/handleAskRequest.ts`, `accountInstructionBlocks`). Asked to plan a new trip, it
refuses in prose and offers nothing to press. That is the failure Mitchell describes, and it is
filed as a candidate (`docs/candidates.md`, *"The assistant knows which surface started the
conversation, and can start a trip from scratch"*).

**Place search only knows our own library.** `searchCities` and `searchPlaces`
(`lib/apiClient.ts`) match cities that already have published days. The world is reachable only
through the server-side LocationIQ geocoder (`server/geocoding/locationiq.ts`), which today the
importer and the `search_places` tool use.

---

## 2. The shape, in one paragraph

**One draft, two editors, one way to create, one place to keep planning.** A *trip draft* holds
everything decided before a trip exists. The **picker** edits it deterministically, for everyone.
The **trip builder** (paid) edits the same draft through the assistant. Both end on the same
**Review** screen, and **Create** is always a person pressing a button. After that the trip lives
on the **plan page**, whose assistant already has the full toolset. The builder knows exactly
what it cannot do, says so with a button rather than an apology, and carries anything it could
not do yet into the plan page so nothing the person asked for is lost.

```
           ┌──────────── picker (all plans, no model) ────────────┐
New trip → │ Where → Start date → How long → Pace → About → Review │ → Create → plan page
           └──────────────────────────────────────────────────────┘      ▲          │
                       ▲ prefill            │ "Plan with AI" (paid)     │          │ assistant,
                       │                    ▼                           │          │ full tools,
Home assistant ──→ trip builder (paid, draft only) ─────────────────────┘          │ carried
"help me plan…"     asks with pickers, shows cards,                                │ follow-ups
                    edits the draft, never creates                                 ▼
```

---

## 3. The picker (everyone)

As drawn on the canvas.

- **One question per page, five pages:** Where, Start date, How long, Pace, What it's about.
  A progress bar and "Step N of 5"; the subtitle carries what is decided so far.
- **Every question is one boxed control** with its options and, where it makes sense, a
  constrained *other*: Where → place search (only a picked result can commit); Start date →
  "Yes, pick a day" opens a date input inside the box, or "Not yet"; How long → four chips plus a
  − / + day counter; Pace → three options, no *other*; About → the activity tags as tiles,
  any or none.
- **No free text anywhere**, so nothing needs interpreting and nothing is silently dropped. No
  intent classifier and no model call on this path.
- **About uses the real tags** (ADR-070 categories minus Lodging and the Ticketed modifier):
  Food, Drinks, Nightlife, Museum, Sight, Outdoors, Beach, Shopping, Show, Tour, Wellness,
  Sports. Each tile uses its tag's tint and ink (`lib/activityTags.ts`, `TAG_CHIP_CLASS`) and an
  icon. **No tag icons exist yet**; the canvas draws lucide-style stand-ins. Picking the set is
  part of this work, and it should become the one icon per tag everywhere.
- **Review** lists every answer with *Change*. *Change* opens that one page and returns to
  Review. **Changing Where re-walks every later page with the earlier answers prefilled**, under a
  "Destination changed" note.
- **Review's buttons depend on the plan.** Free: **Create trip**, and a quiet locked line about AI
  planning. Paid: **Just create it** or **Plan with AI**.

---

## 4. The trip builder (paid)

### 4.1 What it is for, and where it stops

The builder exists to shape a trip **before** it exists, where changing your mind is free:
which places, in what order, for how many nights each, around which interests, starting from
which published days. It works on the draft and nothing else.

| The builder does | The plan page does (hand off) | Nobody does (say so plainly) |
|---|---|---|
| Choose a destination, or several, with you | Stops, times, moving things between days | Book flights, hotels or tables |
| Order the cities and split the nights | Notebooks and their widgets | Live prices or availability |
| Dates, length, pace, interests | Budget and spend | Visas, insurance, payments |
| Pick published days to start from | Inviting people, sharing, publishing | |
| A one-line theme per day (optional, §8 D6) | The map, the calendar, snapshots | |

The middle column is not a refusal: **every one of those is one button away** (§6).

### 4.2 The draft

A typed object in `packages/contracts`, validated on both ends, owned by the thread:

```ts
TripDraft = {
  name: string | null,                 // defaults to the first place's name
  route: { place: PlaceRef, nights: number | null }[],   // one entry for a one-city trip
  start: IsoDate | null,
  days: number | null,                 // derived from nights when every entry has them
  pace: "slow" | "balanced" | "packed" | null,
  tags: ActivityTagCategory[],
  playbookDays: { savedDayId: string, onDay: number | null }[],
  themes: { day: number, line: string }[],               // §8 D6
  carried: CarriedAsk[],               // §6.3
}
```

`PlaceRef` is an id from a place search result, never a string the model typed, so the draft
cannot hold a place nobody found. The picker writes `route[0]`, `start`, `days`, `pace` and
`tags`; the builder writes all of it. **Required to create:** one place and a length (or nights
on every route entry). That is the bar for showing **Create**.

### 4.3 Its tools

New surface `new-trip` in `SURFACES`, granted on paid plans only:

| Tool | Domain / effect | What it does |
|---|---|---|
| `search_places` (exists) | places / spend | World search; returns ids the draft can hold |
| `search_playbooks`, `read_playbook` (exist) | library / read | Published days for a place |
| `places_visited`, `suggest_next_country` (exist) | account / read | "Somewhere I haven't been" |
| `update_draft` (new) | draft / propose | One typed patch to the draft. Refused patches say why (unknown place id, nights that don't add up) |
| `ask_user` (new) | ui / ask | Renders the picker widget (§5.1); ends the step until answered |
| `show_options` (new) | ui / show | Renders cards (§5.2) |
| `hand_off` (new) | system / steer | Renders a hand-off button (§6.1); records the gap |
| `propose_create` (new) | draft / propose | Renders the Review card with **Create**; never creates on its own |

**One `update_draft`, not a tool per field.** Each tool definition costs context on every step
(the reason ADR-057 moved the widget catalogue out of the prompt). The patch schema is the
draft's own, so a field added to the draft is a field the tool can set.

**The draft is always on screen.** A strip above the composer shows the draft as Review would
(place, dates, length, pace, tags) with **Create** once the required fields are set. The person
never has to ask the agent whether it is done, or how to finish.

### 4.4 When the builder offers to create

It offers **Create** (a `propose_create` card) when any of these is true:

1. The required fields are set and the person's latest ask needs a plan-page tool (§4.1, middle
   column). It offers to create *and* carries the ask (§6.3): *"That's a plan-page job. Create
   the trip and I'll do it first thing there."*
2. The person says it looks right, or asks to create, or asks to see the trip.
3. The required fields are set and nothing the builder can still change is open: a route, a
   length, pace, tags, and the playbook-day question answered.

It never ends a turn that wanted a change with prose alone: a turn ends with an `ask_user`, a
`show_options`, an `update_draft` receipt, a `propose_create` card or a `hand_off` button.

---

## 5. Widgets the agent renders

All three are general: the plan page's assistant gets `ask_user` and `show_options` too.

### 5.1 `ask_user`: the picker widget

The same boxed control as the guided picker, with options the model wrote:

```ts
AskUser = {
  question: string,                    // ≤ 120 chars
  options: { id: string, label: string, detail?: string }[],   // 2–6
  multi: boolean,
  other: null
    | { kind: "place" }                          // place search, commits a PlaceRef
    | { kind: "number", min: number, max: number, unit: "days" | "nights" | "people" }
    | { kind: "date" }
    | { kind: "tags" },                          // the activity tags
  allowNone: boolean,                  // for multi
}
```

**The answer comes back as data**, a structured user message (`{ answeredAsk, optionIds,
other }`), not as text the model re-reads. Nothing is parsed and no classifier runs. The
person can still type in the composer instead of answering. On a paid surface that is an
ordinary message, which is the point of the builder.

### 5.2 `show_options`: cards with an action

Places, published days, or route options, each with an id from a tool result and one action
(*Use this*, *Add*, *Start from this*). An action is either an `update_draft` patch the client
applies through the server, or an answer to the open `ask_user`. **Cards can only show what a
tool returned**: the model chooses and orders ids, and the server fills names, photos and
details. That is how the cards stay free of invented places and numbers.

### 5.3 Proposal and Review cards (exist / extended)

The plan page keeps ADR-022's proposal card and ADR-067's stored suggestions. The builder's
`propose_create` renders the Review screen as a card. **Create** goes through
`createTripWithSetup` (`components/home/newTripSubmit.ts`), the same path as the picker, so a
trip made by the builder and one made by the picker cannot differ in how they are created.

---

## 6. Never stuck

### 6.1 Every "I can't" carries a button

`hand_off({ task, to })` is the only way the agent may decline a task it understood. `to` is one
of:

- `plan_page` with a view (`create_first` when no trip exists yet: creates, then opens),
- a palette command (ADR-072's allowlist), for things the person does by hand,
- `upgrade`, only on a surface a free person can reach (§7),
- `nowhere`, for the right-hand column of §4.1, with one sentence saying so.

It renders as a sentence and a button, and it is logged as an `ai.capability_gap` row keyed by
`task`. **That log is the backlog of tools we have not built.** Read it in the `ai-usage` skill.

### 6.2 The agent is told what it can do, generated from code

Each surface's instruction gets a **capability block** rendered from `SURFACES` and the tool
registry: what this surface can change, and for each thing it cannot, which `hand_off` target
serves it. Generated, so a tool added or a grant changed updates the prompt with no prose edit.
`surfaceVoice.test.ts` already checks that a line reaches every surface. The capability block
gets the same test, plus one asserting every domain the surface lacks has a hand-off target.

The account instruction's *"say plainly that changes are made inside a trip"* is replaced by a
`hand_off`. Asked to plan a new trip, Home's assistant opens the builder with what it learned as
the draft (paid), or opens the picker prefilled with what it could map onto fields (free).

### 6.3 What the builder could not do yet is carried, not dropped

`CarriedAsk = { said: string, kind: "stop" | "time" | "budget" | "notebook" | "people" | … }`.
When the builder hands off to the plan page, the trip's assistant thread opens with:

- a one-paragraph summary of the conversation (written by the server from the draft, not by the
  model), and
- the carried asks as chips (*"Add a mezcal tasting on day 3"*). One press runs it as an
  ordinary plan-page turn, which ends in a proposal.

**Nothing the person asked for disappears at the boundary.**

### 6.4 How we know it works

Eval cases in `server/ai/eval/cases.ts` for each boundary: an ask the builder can do, one it
must hand to the plan page, one nobody can do, and one that is off-topic. Graded on whether the
turn ended in a widget (never prose alone), and whether `hand_off` named the right target.

---

## 7. Who gets what

- **Free:** the picker, Review, Create. No assistant anywhere in the flow, and **no chat that
  turns into an upgrade wall halfway through**. The locked line on Review is the only mention.
- **Paid:** the picker, then **Plan with AI**, or the builder straight from Home.
  `useAiEntitled` (`lib/useAiEntitled.ts`) on the client and the server's entitlement check
  (`server/assistant/entitlements.ts`) decide. The server refuses the `new-trip` surface to a
  free account even if the client asks.

---

## 8. Decisions for Mitchell

- **D1. Builder before the trip, or create first?** Recommended: **before**, on a draft, as
  above. Creating first and building on the plan page avoids a second surface, but every
  trip-level rethink ("actually, two cities") then becomes edits to a real trip.
- **D2. Does the draft persist?** Recommended: yes, server-side with the thread, for 7 days, so
  a reload or a phone switch keeps it.
- **D3. World place search:** LocationIQ autocomplete behind `/api/places`, our library's cities
  ranked first and labelled *has Playbooks*. Needs a per-account rate limit and a cache because
  the daily quota is the constraint.
- **D4. Pace and tags on the trip.** Today they go nowhere. Storing them on the trip is a
  contract change (`docs/contracts/CHANGELOG.md`), and the plan page's assistant needs them to
  act on "slow means fewer stops".
- **D5. Carried asks:** run as chips the person presses (recommended), or run automatically on
  arrival?
- **D6. Day themes in the builder** ("Day 3: markets"), or leave every day empty for the plan
  page? Recommended: optional, one line each, because they give the plan page's first proposal
  something to fill.
- **D7. Cass.** The picker speaks as Cass with no AI marking; the builder and plan-page
  assistant carry the AI badge. Keep one name in both, or name only the AI?
- **D8. The icon per tag** (§3): pick the set once, for every surface.

## 9. Suggested parts, if this becomes a milestone

0. Prose: this spec's decisions, the ADR for the `new-trip` surface and `hand_off`.
1. The picker widget component, used by the guided flow (no AI).
2. The guided flow rebuilt on it: five pages, Review, *Change*, re-walk with prefill. Fixes the
   typed-answer bugs in §1 by removing free text.
3. World place search (D3).
4. `TripDraft` contract and its persistence (D2), pace and tags on the trip (D4).
5. `ask_user`, `show_options`, `hand_off` and the generated capability block, on the existing
   surfaces first (Home and the plan page), with the eval cases.
6. The `new-trip` surface: `update_draft`, `propose_create`, the draft strip, Home's hand-off
   into it.
7. Carried asks into the plan page (D5).
