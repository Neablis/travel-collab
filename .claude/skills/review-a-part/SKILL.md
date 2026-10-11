---
name: review-a-part
description: Review policy for one milestone part in travel-collab — a part-reviewer subagent after every push, CodeRabbit at most once on the riskiest part, every finding fixed or answered, and when the part is ready to merge. Use right after a push to a part's PR.
---

# Review a part

1. **After every push, run the `part-reviewer` agent** on the PR and its base (`main`). On a re-run,
   list the fixes the last review asked for so it checks they hold. A push to any branch but `main`
   prints this reminder (`push-review-nudge.mjs`).
2. **CodeRabbit is optional.** Post `@coderabbitai review` once, on the riskiest or largest part
   only, when nothing more will be pushed for a while. This repo gets no automatic CodeRabbit
   reviews (fewer than 10 stars) and about one an hour, so it never paces the work.
3. **Work every finding.** Fix it, or answer on its thread why not and resolve the thread
   (`working-a-review.md`). A finding is a claim to check against the code, not an order.
4. **Fixes go on the part's own branch**, through `build-a-part`. Parts sit on `main`, so nothing
   merges upward.
5. **Ready to merge** when CI is green on the part's head and every finding is fixed or answered.
   Say so in the PR body and in part 0's tracker, tick the part's task, and tell Mitchell.
