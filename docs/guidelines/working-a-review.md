# Working a review — four surfaces, four different mechanics

A PR in this repo collects feedback in **four** places, and they do not behave
alike. None of this is discoverable from any one of them, and every line below
was learned by getting it wrong on a real PR.

`AGENTS.md` owns *when* CodeRabbit runs and who triggers it. This file owns what
to do with the findings once they exist.

## The four surfaces

| Surface | Where it appears | Auto-resolves when fixed? |
|---|---|---|
| **Copilot review** | inline review threads on the diff | **No — never** |
| **CodeRabbit inline** | inline review threads on the diff | **Yes**, on its next run |
| **CodeRabbit walkthrough** | one issue comment, **outside the diff** | n/a — it is edited in place |
| **Vercel toolbar** | threads on the preview deployment | No — and they gate a check |

### Copilot threads never resolve themselves

They stay open forever, including after you push the exact fix they asked for.
Nothing in the PR reflects that the work is done, so a reviewer counting open
threads sees a PR that looks ignored.

**Resolve each thread as you land its fix**, in the same pass — not as a
cleanup at the end, which is how thirteen fixed-in-code threads sat open on
PR #141 until Mitchell asked why. `mcp__github__resolve_review_thread` takes
`owner`, `repo`, and the `threadId` from `pull_request_read`'s
`get_review_comments`.

CodeRabbit's own threads resolve themselves **only when a review actually
re-runs**, and in this repository one never does unless somebody asks for it.
Its walkthrough says why, in the run-configuration block: *"This repository does
not receive automatic reviews because it has fewer than 10 stars."* So a
CodeRabbit thread here behaves exactly like a Copilot one — it stays open
forever, including after the fix it asked for is pushed.

Measured on PR #170, 2026-09-13: fourteen findings, every one fixed and pushed
across four commits, all fourteen still open hours later. **Resolve them as you
land each fix**, on the same terms as Copilot's.

The original wording of this paragraph said CodeRabbit's threads do resolve
themselves, and that is true of a repository whose reviews run automatically —
which is what makes this worth stating rather than deleting. If this repo
crosses ten stars, or the review trigger changes, the old behaviour comes back
and resolving by hand becomes redundant rather than wrong. **Check the
walkthrough's run-configuration block before assuming either.**

### CodeRabbit puts findings outside the diff

Its walkthrough comment carries a **Merge Risk** verdict and a **pre-merge
checks** table (docstring coverage, title, scope) that exist in no thread at
all. Counting or reading review threads misses them entirely.

**Read the walkthrough comment itself, every round.** Two more traps in it:

- It is **edited in place**, so a "new" notification is often the same review
  re-rendered.
- Its Merge Risk line is **stamped with the commit it covers** (`up to
  <sha>`). On PR #141 it read `🟠 High · up to ad3c1` for hours after four
  more commits had landed, including the ones fixing what it was flagging.
  Check the sha before believing the verdict, and say so when reporting it.
- **Where reviews do not re-run automatically, that staleness is permanent**,
  not a lag. On PR #170 the Merge Risk stayed stamped at the PR's opening commit
  through sixteen more, still naming four defects that were fixed — and the
  pre-merge docstring percentage was measured against the same dead commit.
  Nothing recomputes either line until a review is triggered. The reviewer
  reading the PR sees the stale verdict, so correcting it is a **comment on the
  PR mapping each claim to the commit that answered it**, not a note to your
  user.

### Vercel toolbar threads are a fourth inbox, and they gate the PR

Comments left on the preview deployment never appear as GitHub review threads.
They surface only as the **`Vercel Preview Comments`** check, which fails while
any thread is unresolved — so a PR can be green on every real check and still
show red because of a design question nobody has answered.

- Read them with `mcp__Vercel__list_toolbar_threads` (`teamId`, `branch`).
- **Never resolve one to turn the check green.** That check is a human-review
  gate; clearing it without addressing the comment is defeating a control, not
  passing it.
- **Replies post under the token owner's username**, so a thread reads as
  Mitchell answering himself. Say which replies are yours when you report.

## An ask you are not building still has to land somewhere

A preview thread is not a durable record — it is attached to a deployment,
invisible from the repo, and ungreppable. Anything you decline, defer, or offer
to do "next" gets written down before the branch merges:

| The ask is | It goes to |
|---|---|
| a defect or deferred cleanup | `docs/known-issues/open/` |
| an unscheduled feature | `TODO.md` → *Candidate ideas (unscheduled)* |
| a behaviour of what you just built | the spec section that describes it |

Then reply on the thread naming where it went. On PR #141 the phrase *"raised
in the session rather than filed"* meant an ask existed only in a chat
transcript and a preview comment, and would have survived neither.

**Do not leave an offer dangling.** "Say the word and it's the next commit on
this branch" is a promise that expires when the branch merges; either do it or
record it and retract the offer.

## Two failure modes worth naming

**A bot finding is a bug report, not an opinion.** Verify it against the code,
then fix it or say concretely why it is wrong. "Design-level" does not excuse a
finding that names a reachable input and a wrong output.

**A green mutation is usually a bad mutation.** When you break code to prove a
test bites and the suite stays green, the first hypothesis is that you aimed at
the wrong constant, not that the test is weak. On PR #141, widening
`LEGAL_FILTERS.day` left an assertion green because the primitive declares its
own filter list and the matrix is only its ceiling — three separate claims
guarded in three places. Re-aim before you conclude.
