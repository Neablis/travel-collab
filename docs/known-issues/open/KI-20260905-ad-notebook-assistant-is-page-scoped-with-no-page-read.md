### KI-2026-09-05-ad — the notebook assistant is page-*scoped* but has no page-*read*, so it cannot answer a single question about what is on the page

- **Severity:** correctness (a capability the UI advertised and the server cannot perform) — **plus a design-feedback item**, because SPEC §23 specifies an ask that no build could honour without new server work. The user-visible half is fixed on this branch; the gap underneath it is not, and it is what still blocks §23's Notebook quick asks.
- **Area:** `apps/web/src/server/ai/handleAskRequest.ts` (`briefFor`, ~line 714, and the tool assembly at ~line 482), `apps/web/src/server/ai/pageTools.ts`, `apps/web/src/server/ai/readTools.ts`, `apps/web/src/components/assistant/phoneAskContext.ts` (`notebookQuickAsks`, the two Notebook hints), `.design-sync/handoff/SPEC.md` §23.
- **Symptom / What happens:** ask the phone assistant anything about the page you have open — "summarise this", "what is on this page", "which of these is stale?" — and the model answers without ever having seen the document. It cannot refuse informatively either, because nothing tells it the content is missing; the failure mode is a confident answer derived from the page's title.

  The three facts that produce it, each read off the server rather than inferred:

  ```
  # what a page-scoped turn is told about the page
  handleAskRequest.ts: function briefFor(page: Page | null): PageBrief | null {
                         return page === null ? null : { title: page.title };
                       }

  # the tools that turn is handed
  handleAskRequest.ts: const tools = { ...buildReadTools().tools, ...writeTools, ...pageTools };
  readTools.ts:        export const READ_TOOL_NAMES = ["read_trip", "read_day", "find_free_time"];
  pageTools.ts:        insert_text, insert_widget          # inserts only — there is no page read
  ```

  So a page turn can **write into** the document and can **read the trip itinerary**, and those are the only two things it can do. Nothing in the system returns a page's existing nodes to the model, on any scope, on either surface.
- **How it surfaced:** two Copilot findings on PR #148, both against `phoneAskContext.ts` — the Notebook index advertising page awareness while sending a trip scope, and every open page being offered "Summarise this page". Both were verified against the server before being accepted.
- **What was fixed on #148, and what was not.** Fixed: the copy. "Summarise this page" is no longer offered on any surface, and the two Notebook surfaces now describe what each can actually do (the index says it reads the trip's itinerary and cannot read your pages; an open page says an answer lands in the document, reusing `AssistantRail`'s deliberate "add to" framing). Not fixed: the capability. A user who wants a page summarised still cannot have one, and now nothing in the UI even offers to try.
- **The trap for the next person, and it is the reason this entry exists:** `PhoneAskPage.unsetUpWidgets` gates "What is not set up?" on a caller-proven count, and **nothing computes that count today**, so the ask is offered nowhere. It looks like a small, self-contained TODO — compute the unbound-macro count in `PageScreen` and the ask lights up. **Computing it alone re-creates this defect**, because the model still has no way to see which widgets are unbound: the gate proves the question has an answer, not that the assistant can reach it. The count and a page-read tool have to land together, or neither should.
- **Why not fixed here:** the branch's declared scope was §23's phone Ask pill and sheet, and this is a server capability — a new tool in `pageTools.ts` (or page nodes added to `PageBrief`), its own prompt guidance, its own token-cost decision on how much of a document to send, and a `simulatedModel` answer so it works on a deployment where `ai-live` is off. That is a piece of M14/M16 assistant work, not a copy fix.
- **Suggested next step**, in the order that keeps each step honest:
  1. Decide **what a page turn should see** — the whole document, or a rendered summary of its nodes. `markdownToPageNodes.ts` already goes one way; this is the other. Token cost is the deciding constraint, not convenience.
  2. Add the read as a **tool** rather than widening `PageBrief`, so an ask that does not need the document does not pay for it — the same reason `read_day` exists beside `read_trip`.
  3. Teach `simulatedModel` to answer it. Without this the ask is dead on every Vercel environment, which is the exact failure `askChipCoverage.test.ts` was built after.
  4. **Extend `askChipCoverage.test.ts` to `phoneAskContext`.** It enumerates `suggestedQuestions`' chips and drives each through a real turn, and it is the test that would have caught this before Copilot did — it simply does not know the phone's Notebook asks exist. Doing this first would also stop the next §23-shaped chip from shipping unanswerable.
  5. Only then restore "Summarise this page", and wire `unsetUpWidgets` in the same change.
- **Design feedback (not a build defect):** §23's Notebook row specifies *"What is not set up? · Summarise this page"* against both the index and an open page. The index half cannot work by construction — no page is open there, and the sheet is deliberately trip-scoped — and the page half assumes a page-read the assistant has never had. Worth resolving in the design rather than silently: either the Notebook sheet is scoped to answer questions **about the trip** from a notebook surface, or the assistant gains a page-read and §23's row becomes buildable as written.
- **Cross-reference:** SPEC §23; `RULES.md` rule 2 (no purposeless UI — an ask whose honest answer would be fabricated is the worst case of it); `suggestedQuestions.ts` ("never suggest a question whose honest answer is 'there isn't one'"); `askChipCoverage.test.ts` (the same class of defect, caught for the desktop chips on 2026-08-29); ADR-035 decision 5 (insert-shaped page tools, which is *why* the page tool set only writes).
- **First noted:** 2026-09-05, working two Copilot review findings on PR #148.
