# M48 — A planned trip starts from trips that already exist

**Status:** **Proposed 2026-10-11, placed after M47. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted on Mitchell's ask the same day (*"Add as a
upcoming milestone this new feature … its a starting point to validate the proposal, not the
final product"*), from a product brief by Sunny (PM), *Retrieval-augmented plan generation*,
2026-10-11. The brief is not in the repo, so what it asked for is restated here.

**The feature is what this milestone commits to. The brief's technical design is not.** Mitchell,
2026-10-11: the brief was written by an agent outside the repo that could not read all the code,
so *"focus on the feature, we can change the technical decisions"*. Its design is kept below as a
starting sketch, and scoping is free to replace any part of it.

It is placed last because what it saves scales with how many plan turns are served, and there are
few until there are users (Mitchell, 2026-10-03: users before AI cost). **Its first two gates are
offline and touch no serving code**, so they can run earlier than the row order says, beside
another milestone, without moving the row.

## Why this exists

A `plan` turn (*"plan me a 6 day food trip to Tokyo"*) is the most expensive turn the assistant
serves. It runs on the strongest model tier and writes a whole itinerary from nothing, and output
tokens are the dearest tokens there are.

Caesura already holds itineraries the model never sees: the seeded playbooks, and trips people
have built. Every plan turn works out again what those already know.

**The feature:** when someone asks for a plan, the assistant finds a few example days that fit the
request and adapts them, instead of inventing every day. The traveller gets a plan at least as
good as today's. Caesura spends less producing it.

**Success is dollars per plan turn**, read from the M31 ledger. If that number does not move, the
milestone stops and nothing ships.

## What the feature has to be, whatever it is built from

1. **The plan is no worse.** Quality is judged against today's plans before anything ships.
2. **The user's request wins over any example.** Examples are adapted, never copied out.
3. **Examples first, the model alone as the fallback.** Every plan turn looks for examples and
   builds from them when it finds any. If none fit, or the lookup fails or is too slow, the model
   plans from nothing exactly as it does today, so a turn is never broken by this. Confirmed by
   Mitchell, 2026-10-11: *"we still want to be able to build using the model if we fail to
   retrieve from the rag, but we should lean on using the rag first."*
4. **Nobody's private trip informs somebody else's plan.**
5. **It turns off.** With its flag off, the assistant behaves as it does today.
6. **It is proven cheaply before it is built.** Two offline checks come first: that relevant
   example days can be found for real requests, and that plans built from them cost less at the
   same quality. Failing either ends the milestone with no serving code written.
7. **It is not a classifier change and not a search feature.** It runs only on turns already
   classified `plan`. Searching playbooks by meaning in Discover is a separate feature.

## The brief's sketch (a starting point; any of it can change)

- **Examples are days**, not whole trips and not single stops, found by similarity to the request
  in a vector index. Mitchell created an Upstash Vector index on 2026-10-11 to test with (hybrid:
  dense `TEXT_EMBEDDING_3_SMALL` hosted by Upstash, cosine, BM25 sparse).
- **Days are embedded when they are written**, never while a turn is waiting.
- **A plan turn retrieves about 8 candidate days** and puts the best few in front of the model.
- **A later second pass** has a cheap model judge each candidate before it is used. The brief
  calls this a *"Jev evidence filter"* with *"one packed `noul` per candidate"*. Neither term
  exists in this repo, so Sunny needs to say what they mean before that phase is scoped.
- **Three phases:** examples on the same tier as today; then the second pass; then a cheaper tier.
- **Three gates:** recall@5 ≥ 0.7 over 20 to 30 real requests; ≥ 25% fewer output tokens or one
  tier down at equal quality over 10 prompts; then live numbers under a flag.

## What the repo adds to that

Notes for whoever scopes this, from reading the code the brief's author could not.

- **A plan turn writes suggestions, not commands** (M40, ADR-067), so examples go in ahead of
  that path, and *"which examples the turn used"* has to be something a suggestion can answer.
- **Examples cost input tokens, and a plan turn is several model steps**, so they are paid for on
  each step unless cached. Fewer output tokens does not by itself mean a cheaper turn. Measure
  dollars.
- **Nobody has recorded what a plan turn costs today or how many there are.** The ledger has it.
  The whole AI budget is $20 a month, which caps what this can save right now.
- **The seeded corpus is 19 playbook bundle files.** The first check should also count how many
  real requests have any fitting example at all.
- **The brief's second gate changes the examples and the tier together**, so a pass could not say
  which one did it.
- **Example text written by other users is outside text in the prompt.** ADR-043 already says
  how that arrives: as a labelled data block.
- **An example has to be forgettable.** An unpublished or moderated playbook (M12), or a deleted
  trip, must stop being used.
- **Private trip text would be sent to a hosted embedding model.** Nothing user-facing says that
  yet.
- **A vector index is a new store.** Upstash is in the repo only as an expendable Redis cache
  (ADR-059), so a second use wants its own ADR.

## Decisions it needs (recommendations; none answered)

About the feature:

1. **Is the baseline worth beating?** *Recommended:* first, run the `ai-usage` skill and record
   here the dollars per plan turn, the input and output split, and plan turns per month. If plan
   turns are a small share of spend, stop here.
2. **Whose itineraries are examples.** *Recommended:* seeded and published playbooks first. A
   user's own private trips come later, if at all. That keeps commitment 4 true by construction
   in the first build.
3. **Who gets examples** (Sunny's question 2). *Recommended:* any signed-in plan turn.
4. **How "no worse" is judged.** *Recommended:* the M33 eval harness plus Mitchell reading the
   plans side by side.
5. **The bar for "examples can be found"** (Sunny's question 1). *Recommended:* recall@5 ≥ 0.7
   as proposed, plus the coverage count above.
6. **The bar for "it costs less".** *Recommended:* ≥ 25% lower cost per plan turn at equal
   quality, in dollars, across three arms: today, today's tier with examples, a cheaper tier with
   examples. This replaces Sunny's question 4.
7. **Whether the cheaper tier is part of this milestone.** *Recommended:* measure it offline here
   and decide on turning it on once there are live numbers.

About how it is built, all open:

8. **How examples are found.** The sketch says a vector index, and one exists to test with. The
   first offline check is the place to compare it with something plainer, such as filtering
   playbook days by city and tags, which needs no new store.
9. **The example unit** (Sunny's question 3). *Recommended:* the day.
10. **Where the index lives and how it is kept current**, if decision 8 keeps one: its ADR, when
    days are embedded and removed, and whether preview and production share it.
11. **What the second pass is**, once Sunny defines it. Until then it is out of scope.

## Scope

- The baseline and the two offline checks, as scripts and recorded results, before serving code.
- Example days in front of plan turns, behind a flag, falling back to today's path.
- Per plan turn in the M31 ledger: how many examples were used, and what the turn cost.

## Out of scope

- Any change to the intent classifier.
- Examples drawn from the trip being edited. Trips are tens of stops, and it would save little.
- Semantic search in Discover.
- Turning on a cheaper tier in production, until decision 7 says otherwise.
- Private trips as examples, until decision 2 says otherwise.

## Exit gate

- [ ] **Decisions 1–11 are answered and recorded here**, with an ADR for any new store.
- [ ] **The baseline is pasted here**: dollars per plan turn, input and output split, plan turns
      per month (`ai-usage` skill output).
- [ ] **The first offline check is run and its numbers are pasted here**: recall and corpus
      coverage over the labelled requests. Below the bar, the milestone closes here with a retro
      and no serving code.
- [ ] **The second offline check is run and its three arms are pasted here**, in dollars per
      turn, with the quality verdict. Below the bar, the same.
- [ ] **With the flag off, a plan turn looks up no examples and sends the model the same prompt
      as today.** A test is seen red with the flag check removed.
- [ ] **A lookup that throws, times out or returns nothing leaves the turn working.** One test
      per case, each seen red.
- [ ] **A playbook that is unpublished or taken down is not used as an example.** A test
      is seen red.
- [ ] **No model id is a literal in kernel code** (ADR-019): the lint wall passes.
- [ ] **The ledger shows example count, output tokens and tier per plan turn** (`ai-usage`
      skill output pasted here), and dollars per plan turn with the flag on against the baseline.
- [ ] **[walk]** On the PR preview with the flag on, ask *"plan a 6 day food trip to Tokyo"*,
      and the suggestions it writes are a plan Mitchell would accept.
- [ ] A retro is appended at gate close.
