# Working a review — three surfaces, three different mechanics

A PR in this repo collects feedback in **three** places, and they do not behave
alike. None of this is discoverable from any one of them, and every line below
was learned by getting it wrong on a real PR.

`AGENTS.md` owns who reviews (*Review is ours*: a `part-reviewer` subagent after
every push; CodeRabbit was removed on 2026-10-13). This file owns what to do with
the findings once they exist, and how much of it goes on GitHub.

## The three surfaces

| Surface | Where it appears | Auto-resolves when fixed? |
|---|---|---|
| **Our review comment** | one PR comment per review, posted by the orchestrator | n/a — a fix is a one-line thread reply |
| **Copilot review** | inline review threads on the diff | **No — never** |
| **Vercel toolbar** | threads on the preview deployment | No — and they gate a check |

### Review threads never resolve themselves

Copilot's threads, and any inline thread a person opens, stay open forever,
including after you push the exact fix they asked for. Nothing in the PR
reflects that the work is done, so a reviewer counting open threads sees a PR
that looks ignored.

**Resolve each thread as you land its fix**, in the same pass — not as a
cleanup at the end, which is how thirteen fixed-in-code threads sat open on
PR #141 until Mitchell asked why. `mcp__github__resolve_review_thread` takes
`owner`, `repo`, and the `threadId` from `pull_request_read`'s
`get_review_comments`.

### Vercel toolbar threads are a third inbox, and they gate the PR

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

**A review finding is a bug report, not an opinion**, whether a `part-reviewer`
or Copilot wrote it. Verify it against the code,
then fix it or say concretely why it is wrong. "Design-level" does not excuse a
finding that names a reachable input and a wrong output.

**A green mutation is usually a bad mutation.** When you break code to prove a
test bites and the suite stays green, the first hypothesis is that you aimed at
the wrong constant, not that the test is weak. On PR #141, widening
`LEGAL_FILTERS.day` left an assertion green because the primitive declares its
own filter list and the matrix is only its ceiling — three separate claims
guarded in three places. Re-aim before you conclude.
