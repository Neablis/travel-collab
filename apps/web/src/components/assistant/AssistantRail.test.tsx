import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASK_FAILED_MESSAGE } from "@tc/contracts";
import { AssistantRail } from "./AssistantRail";
import { BeyondTripAssistant } from "./BeyondTripAssistant";
import { useAssistantVisibility } from "./useAssistantVisibility";
import { setViewportMatches } from "../../../vitest.setup";
import { ownedAskName } from "@/lib/askOwnership";
import { loadAskDraft, saveAskDraft } from "./askThreadStore";
import type { AssistantTurn } from "./Transcript";

// **The hook is mocked so the prop's precedence can actually be tested.**
// Un-mocked it issues a `fetch` jsdom never answers, so it stays `null`
// forever — and a test asserting "an explicit `null` prop keeps the composer
// live" then passes whether the prop wins or not, because BOTH sides are
// `null`. That is the defect CodeRabbit found in the code and it was invisible
// here for exactly the same reason. `aiEntitledFetched` is what this controls.
const fetchedEntitlement = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock("@/lib/useAiEntitled", () => ({
  useAiEntitled: () => fetchedEntitlement.value,
  AI_ASK_ENTITLEMENT: "ai.ask",
  accountPlanKey: "account:plan",
}));

// Who is signed in: the draft is stored under their id (`ownedAskName`).
const session = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null | undefined }));
vi.mock("@/components/account/useSessionUser", async (orig) => ({
  ...(await orig<typeof import("@/components/account/useSessionUser")>()),
  useKnownSessionUser: () => session.user,
}));

afterEach(() => {
  fetchedEntitlement.value = null;
  session.user = { id: "user-a" };
  cleanup();
});


// Required-prop fixture for tests that assert on a specific optional prop
// (e.g. `simulated`) without needing renderRail's override merging — mirrors
// the same values renderRail defaults to below.
const baseProps: React.ComponentProps<typeof AssistantRail> = {
  contextLine: "Looking at Day 2 · Kyoto",
  scope: { kind: "day", dayIndex: 1 },
  turns: [],
  suggestions: [],
  asksRemaining: 20,
  onAsk: vi.fn(),
  onApproveProposal: vi.fn(),
  onRejectProposal: vi.fn(),
  onNewConversation: vi.fn(),
  onHide: vi.fn(),
};

function renderRail(overrides: Partial<React.ComponentProps<typeof AssistantRail>> = {}) {
  return render(<AssistantRail {...baseProps} onAsk={vi.fn()} onHide={vi.fn()} {...overrides} />);
}

// M16 Wave 1 (Task 4, SPEC §9 docked presentation): the rail is a flex
// sibling of the plan now, not a `position: fixed` overlay with a scrim in
// front of it (KI-16, KI-17) — there is no scrim left to test.
//
// M16 Wave 2 (Task 5): the chip row is back, but as `suggestions` — derived
// from real trip state by suggestedQuestions.ts, which has its own suite for
// the rules. What this file asserts about them is only what the rail owns:
// that they are offered while the thread is empty, that clicking one asks it,
// and that they get out of the way once a conversation is running.
describe("AssistantRail", () => {
  it("renders the context line", () => {
    renderRail();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });

  // The "What I noticed" shelf is deliberately absent (Mitchell, preview
  // feedback on PR #55; the 2026-08-24 design's panel markup has no such
  // block either). Asserted, not merely deleted, so re-adding it is a
  // failing test rather than a silent regression.
  it("has no \"What I noticed\" shelf, and holds the conversation space with the design's hint", () => {
    renderRail();
    expect(screen.queryByText("What I noticed")).toBeNull();
    expect(screen.getByText("Ask about this trip and the conversation stays here.")).not.toBeNull();
  });

  // SPEC §23 / DRIFT §2i: the sheet's copy is derived from the surface it was
  // opened on, and the default sentence is a trip-wide claim — false on a
  // day-scoped or page-scoped sheet, which is exactly where the phone opens
  // it. `phoneAskContext` supplies the honest one; this is the seam it arrives
  // through. Both halves asserted, because a prop that is accepted and then
  // ignored would leave the test above green on its own.
  it("prints the caller's empty hint instead of the default when it is given one", () => {
    renderRail({ emptyHint: "It reads the page you have open, its widgets and what they are pointed at." });
    expect(
      screen.getByText("It reads the page you have open, its widgets and what they are pointed at."),
    ).not.toBeNull();
    expect(screen.queryByText("Ask about this trip and the conversation stays here.")).toBeNull();
  });

  it("the Ask box is real: typing and submitting calls onAsk with the typed text", async () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Where am I overbooked?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));
    expect(onAsk).toHaveBeenCalledWith("Where am I overbooked?");
    // Awaited: the clear now waits on onAsk's answer, because a refused ask
    // keeps the prompt. An accepted one still clears, one microtask later.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  // The refusal half of the same rule. TripBoardScreen returns false when
  // unsent edits are still queued; the ask never reaches the model, so making
  // the user retype it would read as the box being broken.
  it("keeps the typed prompt when onAsk refuses the ask", async () => {
    const onAsk = vi.fn().mockResolvedValue(false);
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Where am I overbooked?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));
    expect(onAsk).toHaveBeenCalledWith("Where am I overbooked?");

    // The prompt only survives if it survives PAST the await inside submitAsk,
    // so the flush is load-bearing and is written out rather than implied. It
    // was implied before, by `await waitFor(() => expect(onAsk)…)`: that
    // condition is satisfied on its first synchronous callback run, and what
    // actually let the clear land was waitFor's own asyncWrapper draining the
    // microtask queue inside `act`. Measured, not assumed — an unconditional
    // `setAsk("")` fails both forms — but a test whose bite comes from a
    // library implementation detail it never names is one refactor away from
    // silently asserting nothing.
    await act(async () => {
      await Promise.resolve();
    });
    expect((input as HTMLInputElement).value).toBe("Where am I overbooked?");
  });

  it("submits on Enter", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Cheapest way between cities" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("Cheapest way between cities");
  });

  // KI-2026-09-07-c: the composer itself must stay ENABLED while a turn is
  // in flight. `disabled` on a focused input blurs it in every real browser
  // (jsdom does not reproduce that), and re-enabling it afterwards does not
  // restore focus — so a follow-up typed mid-turn went to `<body>` and was
  // silently dropped, `Enter` included. The Ask button is what actually needs
  // gating, and does: `submitAsk` also refuses while `asking` is true, so
  // nothing can be sent twice.
  it("shows a busy label and disables the Ask button while asking, but leaves the composer itself enabled", () => {
    renderRail({ asking: true });
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Asking…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // The sentence `/ask` actually sends when the model fails (its 503 body and
  // its stream error chunk alike) — never the provider's own text.
  it("shows an inline error when the last ask failed", () => {
    renderRail({ askError: ASK_FAILED_MESSAGE });
    expect(screen.getByRole("alert").textContent).toBe(ASK_FAILED_MESSAGE);
  });

  // **An upgrade path, not a permission error** (M20 link 4's gate box). The
  // server answers 402 Payment Required here rather than 403, and the two
  // differ by exactly this: a 403 says the account did something it may not, a
  // 402 says it does not have a thing it could have. Rendering both as a red
  // alert throws that distinction away at the one surface where it is worth
  // something.
  describe("the entitlement refusal", () => {
    const REFUSAL = "The assistant is part of Plus. This account is on a plan that does not include it.";

    it("is a status rather than an alert, and keeps the server's wording", () => {
      renderRail({ askError: REFUSAL, askUpgrade: true });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status").textContent).toContain(REFUSAL);
    });

    // **The seam M20 left is filled** (M21, 2026-09-15). This used to assert
    // the opposite — no control, and the sentence "Plans live in your account
    // settings" — which was right while there was nowhere to send anyone. §29
    // gives plans a route, so the dead end is a CTA.
    it("offers a way to the plans route", () => {
      renderRail({ askError: REFUSAL, askUpgrade: true });
      expect(screen.getByTestId("assistant-upgrade-cta").getAttribute("href")).toBe("/plans");
    });

    // **The composer is inert, not merely captioned.** A live-looking box under
    // an upgrade notice invites the same refusal a second time.
    it("disables everything that could send another question", () => {
      renderRail({ askError: REFUSAL, askUpgrade: true });
      expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Ask the assistant" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    // **Known before the first question, which is the point of `aiEntitled`.**
    // The refusal above is this same state learned the expensive way; a reader
    // on a plan without the assistant should never have to spend a question to
    // find out.
    it("gates on the plan alone, with no refusal and no askError", () => {
      renderRail({ aiEntitled: false });
      expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(true);
      expect(screen.getByTestId("assistant-upgrade-cta").getAttribute("href")).toBe("/plans");
      // Our sentence, not the server's — nothing has been refused yet.
      expect(screen.getByRole("status").textContent).toContain("The assistant is part of Plus.");
    });

    // A suggested question is an ask with the typing done for you. Leaving the
    // chips live would make the disabled box decorative — and this is the
    // assertion that would have caught it, because every other one here passes
    // with the chips still clickable.
    it("gates the suggested questions too", () => {
      const onAsk = vi.fn();
      renderRail({ aiEntitled: false, suggestions: ["What should I do on day one?"], onAsk });
      const chip = screen.getByRole("button", { name: "What should I do on day one?" });
      expect((chip as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(chip);
      expect(onAsk).not.toHaveBeenCalled();
    });

    // **`null` is not `false`.** The hook resolves `null` while the plan is
    // still being read and whenever that read fails, and treating either as
    // "not entitled" would flash a paywall at a paying subscriber on every
    // open. Being wrong the other way costs one refused request.
    it("treats an unknown plan as entitled", () => {
      renderRail({ aiEntitled: null });
      expect(
        (screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled,
      ).toBe(false);
      expect(screen.queryByTestId("assistant-upgrade-cta")).toBeNull();
    });

    // **A supplied prop wins, including when it is `null`** — the rail's own
    // documented contract, and `??` broke it: `null` read as "absent", so the
    // hook's `false` replaced it and gated a rail the caller had explicitly
    // said not to gate. The mock at the top of this file is what makes the two
    // sides differ; without it both are `null` and this passes either way.
    it("lets an explicit null prop beat a resolved non-entitled fetch", () => {
      fetchedEntitlement.value = false;
      renderRail({ aiEntitled: null });
      expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(
        false,
      );
      expect(screen.queryByTestId("assistant-upgrade-cta")).toBeNull();
    });

    // **A transport failure is not a paywall, even on a gated account.**
    // `askError` outlives the ask that set it, so a dropped connection before
    // the plan read landed leaves it set with `askUpgrade` false — printing it
    // in the upgrade block would put "The assistant couldn't answer just now"
    // above a See plans button.
    it("does not read a transport failure as the entitlement refusal", () => {
      renderRail({ aiEntitled: false, askError: ASK_FAILED_MESSAGE });
      const status = screen.getByRole("status").textContent ?? "";
      expect(status).toContain("The assistant is part of Plus.");
      expect(status).not.toContain(ASK_FAILED_MESSAGE);
    });

    // Every OTHER refusal is still a failure and still red. The flag is what
    // separates them, and it comes from the server's `code` rather than from
    // the prose.
    it("leaves an ordinary failure as an alert", () => {
      renderRail({ askError: ASK_FAILED_MESSAGE });
      expect(screen.getByRole("alert")).not.toBeNull();
    });

    // No price anywhere on this surface. M20 never learns what a plan costs.
    it("names the tier and no price", () => {
      renderRail({ askError: REFUSAL, askUpgrade: true });
      const rendered = screen.getByRole("status").textContent ?? "";
      expect(rendered).toContain("Plus");
      expect(rendered).not.toMatch(/\$|\bUSD\b|per month/i);
    });
  });

  it("the Hide control is real: clicking it calls onHide", () => {
    const onHide = vi.fn();
    renderRail({ onHide });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("shows a Simulated badge when the last answer came from the server, not a model", () => {
    render(<AssistantRail {...baseProps} simulated />);
    expect(screen.getByText("Simulated")).not.toBeNull();
  });

  it("shows no badge for a real answer", () => {
    render(<AssistantRail {...baseProps} />);
    expect(screen.queryByText("Simulated")).toBeNull();
  });

  // ---- M16 Wave 2: the conversation ----

  it("renders the thread when there is one, both sides of it", () => {
    const turns: AssistantTurn[] = [
      { id: "u1", role: "user", text: "What's the plan for day 2?" },
      { id: "a1", role: "assistant", text: "Two stops.", tools: [], pending: false },
    ];
    renderRail({ turns });
    expect(screen.getByRole("log", { name: "Conversation" }).textContent).toContain("What's the plan for day 2?");
    expect(screen.getByText("Two stops.")).not.toBeNull();
  });

  it("drops the empty hint once the conversation has started", () => {
    renderRail({ turns: [{ id: "u1", role: "user", text: "hi" }] });
    expect(screen.queryByText("Ask about this trip and the conversation stays here.")).toBeNull();
  });

  it("offers the derived suggestions while the thread is empty, and asks the one you click", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk, suggestions: ["What's the plan for day 3?", "Where's the most free time on day 3?"] });
    const chips = within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "What's the plan for day 3?",
      "Where's the most free time on day 3?",
    ]);
    fireEvent.click(chips[0]!);
    expect(onAsk).toHaveBeenCalledWith("What's the plan for day 3?");
  });

  // They exist to START a conversation. Mid-thread they would be offering
  // questions the user may already have had answered, in the space the answers
  // themselves need.
  it("withdraws the suggestions once a conversation is running", () => {
    renderRail({
      suggestions: ["What's the plan for day 3?"],
      turns: [{ id: "u1", role: "user", text: "hi" }],
    });
    expect(screen.queryByRole("list", { name: "Suggested questions" })).toBeNull();
  });

  it("renders no suggestion list at all when the trip yields none", () => {
    renderRail({ suggestions: [] });
    expect(screen.queryByRole("list", { name: "Suggested questions" })).toBeNull();
  });

  it("disables the suggestions while a turn is streaming", () => {
    renderRail({ suggestions: ["How is the trip looking?"], asking: true });
    expect((screen.getByRole("button", { name: "How is the trip looking?" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("offers New conversation only once there is a conversation to clear", () => {
    const onNewConversation = vi.fn();
    const { rerender } = renderRail();
    expect(screen.queryByRole("button", { name: "New conversation" })).toBeNull();
    rerender(
      <AssistantRail
        {...baseProps}
        onNewConversation={onNewConversation}
        turns={[{ id: "u1", role: "user", text: "hi" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(onNewConversation).toHaveBeenCalledOnce();
  });

  // The board sets this when a turn it had already accepted was rolled back.
  // Same promise the `false` refusal above keeps, kept a moment later.
  it("puts a rolled-back question back in the composer", () => {
    const { rerender } = renderRail();
    const input = screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;
    expect(input.value).toBe("");
    rerender(<AssistantRail {...baseProps} restoreDraft="a very long question" />);
    expect(input.value).toBe("a very long question");
  });

  it("leaves the composer alone while there is nothing to restore", () => {
    renderRail({ restoreDraft: null });
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).value).toBe("");
  });
});

// Finding 3 of the final branch review: the composer said "this day" under a
// context line that said "Looking at <trip>". Both are worded from the same
// scope now, so they cannot contradict each other.
describe("AssistantRail — the composer follows the scope", () => {
  it("asks about the day when the turn is day-scoped", () => {
    renderRail({ scope: { kind: "day", dayIndex: 1 } });
    expect(screen.getByPlaceholderText("Ask about this day…")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Ask about this trip…")).toBeNull();
  });

  it("asks about the trip when the turn is trip-scoped", () => {
    renderRail({ scope: { kind: "trip" }, contextLine: "Looking at Kyoto 2027" });
    expect(screen.getByPlaceholderText("Ask about this trip…")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Ask about this day…")).toBeNull();
  });
});

// SPEC §23: the phone gets the assistant as a bottom sheet over what it was
// already looking at. Two things this block can honestly assert, and one it
// cannot. It CAN assert the scrim is real and dismisses (DRIFT.md build-check
// 4c's whole point is that the tab bar behind an open sheet must not be
// reachable, and a scrim that renders but does not close is the half-built
// version of that), and it CAN assert the sheet kept ONE way out rather than
// gaining a second. It CANNOT assert the 44px floor or the z-index order:
// jsdom applies no stylesheet, so `getComputedStyle` here would report the
// defaults for every rule in `globals.css` and a test built on it would pass
// against no geometry at all. Those live in the browser lane.
describe("AssistantRail — SPEC §23's sheet presentation", () => {
  it("lays a scrim over the page, and clicking it hides the assistant", () => {
    const onHide = vi.fn();
    renderRail({ presentation: "sheet", onHide });
    fireEvent.click(screen.getByTestId("assistant-scrim"));
    expect(onHide).toHaveBeenCalledOnce();
  });

  // The scrim covers the phone tab bar, so a presentation that is not over a
  // phone must not have one: docked is a flex sibling with nothing to cover
  // (the scrim that used to sit in front of it was deleted outright — KI-16,
  // KI-17), and floating is a desktop card whose whole premise is that the
  // page behind it stays live.
  it("renders no scrim in the docked or floating presentations", () => {
    const { rerender } = renderRail({ presentation: "docked" });
    expect(screen.queryByTestId("assistant-scrim")).toBeNull();
    rerender(<AssistantRail {...baseProps} presentation="floating" />);
    expect(screen.queryByTestId("assistant-scrim")).toBeNull();
  });

  // One control, not two. The scrim is a dismissal SURFACE and the design
  // draws exactly one dismissal BUTTON — an ✕ where docked and floating write
  // "Hide" — so a sheet carrying both would be the same act rendered twice in
  // a 390px row (RULES.md rule 4).
  it("carries exactly one dismissal control, the design's ✕ where docked says Hide", () => {
    renderRail({ presentation: "sheet" });
    expect(screen.getAllByRole("button", { name: /hide|close|dismiss/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hide" }).textContent).toBe("✕");
    expect(screen.queryByText("Hide")).toBeNull();
  });

  // §23 keeps the panel: same mark, same heading, same stated scope. "Scope is
  // stated, never inferred by the user" is the section's own rule, and the
  // context line is where it is stated.
  it("keeps the panel's mark, heading and context line", () => {
    renderRail({ presentation: "sheet" });
    expect(screen.getByTestId("brand-mark")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Assistant" })).not.toBeNull();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });
});

// The half of build-check 4c the scrim was never able to keep (Copilot, PR
// #148). A scrim stops a FINGER. It does not stop Tab, it does not stop
// Escape, and it does not tell a screen reader that the plan behind it is
// covered — so before this the pill kept focus behind the open sheet, the
// phone tab bar was still in the tab order, and a keyboard user could switch
// tabs mid-conversation and change its scope, which is the one failure §23
// exists to prevent.
//
// Every assertion here is behavioural on purpose. jsdom applies no stylesheet,
// so anything phrased as geometry or z-order would be asserting against
// `globals.css` rules that never loaded; where focus IS, and what a role query
// can still reach, are real in jsdom and are what the finding was about.
//
// The mechanism is Radix's Dialog — the same primitive `ui/sheet.tsx` uses.
// Not `<dialog showModal>`: jsdom 29.1.1 implements neither `showModal` nor
// `inert` (probed 2026-09-05), so the platform version of this would be a
// modal claim with no test under it.
describe("AssistantRail — the sheet is a real modal, not just a scrim", () => {
  /**
   * The sheet, its opener, and one control on either side of it.
   *
   * The opener is kept OUTSIDE the rail and mounted either side of it, which
   * is what makes focus restoration testable at all — `unmount()` would detach
   * the opener along with the sheet, and focus cannot return to a node that is
   * no longer in the document. `After` exists so a Tab that ESCAPES the sheet
   * has somewhere to land: without it the document's last control is the
   * sheet's own, and an untrapped Tab would wrap back into the sheet by
   * accident and pass a test meant to catch exactly that.
   */
  function Harness({
    open,
    presentation = "sheet",
    onHide = vi.fn(),
    onOpenerClick = vi.fn(),
    onAfterClick = vi.fn(),
  }: {
    open: boolean;
    presentation?: "sheet" | "docked" | "floating";
    onHide?: () => void;
    onOpenerClick?: () => void;
    onAfterClick?: () => void;
  }) {
    return (
      <>
        <button type="button" onClick={onOpenerClick}>
          Open the assistant
        </button>
        {open ? <AssistantRail {...baseProps} presentation={presentation} onHide={onHide} /> : null}
        <button type="button" onClick={onAfterClick}>
          After
        </button>
      </>
    );
  }

  // Where focus IS, asserted through what a key press reaches rather than by
  // reading `document.activeElement` — the test-quality wall bans that
  // property and grandfathers only the two call sites that predate it
  // (KI-2026-09-02-b, "do not add more"). TripHeader's tab-order test settled
  // the same problem the same way, and the substitution is not a workaround:
  // "the sheet has focus" is only worth asserting because it decides which
  // control the next keystroke operates, so operating one says it directly.
  //
  // Space rather than Enter, for TripHeader's reason — a button activates on
  // Space and a link does not, so a probe that lands on the wrong thing stays
  // silent instead of quietly passing.
  const pressSpace = () => userEvent.keyboard("[Space]");

  it("closes on Escape, which the scrim could never do", () => {
    const onHide = vi.fn();
    renderRail({ presentation: "sheet", onHide });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onHide).toHaveBeenCalledOnce();
  });

  it("moves focus into the sheet when it opens, off the control behind it", async () => {
    const onHide = vi.fn();
    const onOpenerClick = vi.fn();
    const { rerender } = render(<Harness open={false} onOpenerClick={onOpenerClick} />);
    screen.getByRole("button", { name: "Open the assistant" }).focus();

    rerender(<Harness open onHide={onHide} onOpenerClick={onOpenerClick} />);
    await pressSpace();

    // The sheet's ✕ took the keystroke, so focus is inside the sheet; the
    // opener did not, so it is no longer where it was.
    expect(onHide).toHaveBeenCalledOnce();
    expect(onOpenerClick).not.toHaveBeenCalled();
  });

  // The restore is awaited, not synchronous: Radix's FocusScope defers its
  // unmount handler by a `setTimeout(0)`, so at the instant the sheet is torn
  // down focus has fallen to <body> and only lands back on the opener a tick
  // later. Asserting it immediately reads as correct and fails against a
  // working implementation — which is how this test first failed.
  it("returns focus to the control that opened it when it closes", async () => {
    const onOpenerClick = vi.fn();
    const { rerender } = render(<Harness open={false} onOpenerClick={onOpenerClick} />);
    screen.getByRole("button", { name: "Open the assistant" }).focus();
    rerender(<Harness open onOpenerClick={onOpenerClick} />);

    // Focus has to LEAVE before returning can mean anything. Without this the
    // test passes against a build that never moved focus at all — measured,
    // not guessed: it is the one assertion that stayed green when the whole
    // modal wrapper was removed.
    await pressSpace();
    expect(onOpenerClick).not.toHaveBeenCalled();

    rerender(<Harness open={false} onOpenerClick={onOpenerClick} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await pressSpace();

    expect(onOpenerClick).toHaveBeenCalledOnce();
  });

  // Typing first so the Ask button is enabled — a disabled control is not a
  // tabbable candidate, so without it the sheet's last edge would be the
  // composer and this would be asserting something weaker than it reads as.
  it("contains Tab: from the last control it wraps to the first, rather than reaching the page", async () => {
    const onHide = vi.fn();
    const onAfterClick = vi.fn();
    render(<Harness open onHide={onHide} onAfterClick={onAfterClick} />);
    fireEvent.change(screen.getByPlaceholderText(/ask about this day/i), { target: { value: "anything" } });
    screen.getByRole("button", { name: "Ask the assistant" }).focus();

    await userEvent.tab();
    await pressSpace();

    // Round to the sheet's own first control, not out to the page behind it.
    expect(onHide).toHaveBeenCalledOnce();
    expect(onAfterClick).not.toHaveBeenCalled();
  });

  // The wrap above is only the SEQUENTIAL half of containment, and on its own
  // it is weaker than it reads: Radix's FocusScope loops Tab whenever `loop`
  // is set, trapped or not. What makes the page behind genuinely unreachable
  // is the trap — focus that lands outside the scope by any route at all is
  // pulled back. Worth its own test because the two are separate Radix flags
  // and only one of them is what build-check 4c needs.
  it("pulls focus back when something behind the sheet takes it", async () => {
    const onHide = vi.fn();
    const onAfterClick = vi.fn();
    render(<Harness open onHide={onHide} onAfterClick={onAfterClick} />);

    // `getByText`, not `getByRole`: the control behind an open sheet is
    // `aria-hidden` by then (the test below is about exactly that), so a role
    // query cannot reach it — and reaching it anyway is the point here. This
    // is the route a mouse or a stray `.focus()` still has when the
    // accessibility tree has already been told the page is covered.
    screen.getByText("After").focus();
    await pressSpace();

    expect(onAfterClick).not.toHaveBeenCalled();
    expect(onHide).toHaveBeenCalledOnce();
  });

  // The screen-reader half of the scrim. A role query skips `aria-hidden`
  // subtrees, which is exactly the tree assistive tech walks — so a control
  // that a role query can no longer find is a control a screen reader can no
  // longer land on. This is what the scrim was only ever pretending to do.
  it("hides the page behind it from assistive tech, tab bar included", () => {
    render(
      <>
        <nav aria-label="Phone navigation">
          <a href="/plan">Plan</a>
        </nav>
        <AssistantRail {...baseProps} presentation="sheet" onHide={vi.fn()} />
      </>,
    );

    expect(screen.queryByRole("link", { name: "Plan" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Phone navigation" })).toBeNull();
    // Not a blanket hide — the sheet's own controls are still reachable, or
    // this would pass just as well with the whole document hidden.
    expect(screen.getByRole("button", { name: "Hide" })).not.toBeNull();
  });

  // The desktop presentations are NOT modal and must not become so: docked is
  // a flex sibling of the plan and floating is a card beside it, and both
  // leave the page live on purpose (§9). Asserted rather than assumed, because
  // the modal wrapper above is one `isSheet` away from applying to all three.
  it.each(["docked", "floating"] as const)("leaves the %s presentation unmodal", async (presentation) => {
    const onHide = vi.fn();
    const onAfterClick = vi.fn();
    render(<Harness open presentation={presentation} onHide={onHide} onAfterClick={onAfterClick} />);

    // Escape is the page's to handle, not this panel's.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onHide).not.toHaveBeenCalled();

    // The page behind stays reachable, and keeps focus rather than losing it
    // to a trap that should not exist here.
    screen.getByRole("button", { name: "After" }).focus();
    await pressSpace();
    expect(onAfterClick).toHaveBeenCalledOnce();
    expect(onHide).not.toHaveBeenCalled();
  });
});

// Finding 2: `MAX_ASK_MESSAGES` was a server 400 with no counterpart here, so
// the 41st message failed the turn and nothing said New conversation was the
// way out. `asksRemaining` is counted by the board (it owns the thread and
// builds what is posted); the rail owns what to do about it.
describe("AssistantRail — the thread's ceiling", () => {
  const someThread: AssistantTurn[] = [
    { id: "u1", role: "user", text: "How is the trip looking?" },
    { id: "a1", role: "assistant", text: "Three days.", tools: [], pending: false },
  ];

  it("says nothing while the thread has room", () => {
    renderRail({ turns: someThread, asksRemaining: 4 });
    expect(screen.queryByText(/room for/i)).toBeNull();
    expect(screen.getByPlaceholderText(/ask about this/i)).not.toBeNull();
  });

  it("warns as the thread fills, in questions rather than messages", () => {
    renderRail({ turns: someThread, asksRemaining: 3 });
    expect(screen.getByText("Room for 3 more questions in this conversation.")).not.toBeNull();
    // Still usable — a warning, not a wall.
    expect(screen.getByPlaceholderText(/ask about this/i)).not.toBeNull();
  });

  it("counts the last one in the singular", () => {
    renderRail({ turns: someThread, asksRemaining: 1 });
    expect(screen.getByText("Room for 1 more question in this conversation.")).not.toBeNull();
  });

  it("replaces the composer with the way out once it is full", () => {
    const onNewConversation = vi.fn();
    renderRail({ turns: someThread, asksRemaining: 0, onNewConversation });
    // The composer is gone rather than sitting there looking ready.
    expect(screen.queryByPlaceholderText(/ask about this/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(screen.getByText(/reached its limit of 40 messages/)).not.toBeNull();

    // And the exit is a real control, clicked rather than typed at.
    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  // Nothing is dropped behind the user's back: the thread they can see is the
  // thread that exists until they say otherwise.
  it("still shows the whole conversation when it is full", () => {
    renderRail({ turns: someThread, asksRemaining: 0 });
    expect(screen.getByText("How is the trip looking?")).not.toBeNull();
    expect(screen.getByText("Three days.")).not.toBeNull();
  });
});

// SPEC §9, M26 links 10a and 10b: "One panel, three presentations, and the user
// picks", and "Position is clamped to the viewport with a 16px pad, and
// re-clamped on resize."
describe("AssistantRail — the shape is the reader's, and the floating one drags", () => {
  function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  }

  function positionOf(): { left: string; top: string } {
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    return { left: panel.style.left, top: panel.style.top };
  }

  /**
   * **Give the panel a real box.** jsdom reports every element as a zero-sized
   * rect at 0,0, and the drag starts from `getBoundingClientRect()` — which in
   * a browser is the panel's true current position, pinned by
   * `.assistant-float`'s `right`/`bottom`, and is the only honest place a drag
   * can start from. Without this the delta assertions below would be measuring
   * jsdom's missing layout rather than the drag.
   */
  function placePanelAt(x: number, y: number) {
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    panel.getBoundingClientRect = () =>
      ({ left: x, top: y, width: 364, height: 476, right: x + 364, bottom: y + 476, x, y }) as DOMRect;
  }

  function dragHeaderBy(dx: number, dy: number, from = { x: 1200, y: 400 }) {
    fireEvent.pointerDown(screen.getByTestId("assistant-header"), {
      button: 0,
      clientX: from.x,
      clientY: from.y,
    });
    fireEvent.pointerMove(window, { clientX: from.x + dx, clientY: from.y + dy });
    fireEvent.pointerUp(window);
  }

  it("offers one control whose name says what it will do", async () => {
    const onShapeChange = vi.fn();
    renderRail({ presentation: "floating", onShapeChange });
    // The artboard draws ONE button whose title flips (dc.html:4018/:10062).
    // A button called "Dock" that undocks would be worse than no button.
    await userEvent.click(screen.getByRole("button", { name: "Dock to the side" }));
    expect(onShapeChange).toHaveBeenCalledWith("docked");

    cleanup();
    const onShapeChange2 = vi.fn();
    renderRail({ presentation: "docked", onShapeChange: onShapeChange2 });
    await userEvent.click(screen.getByRole("button", { name: "Float it free" }));
    expect(onShapeChange2).toHaveBeenCalledWith("floating");
  });

  // §23 gives the phone a sheet and only a sheet; a Dock button there would
  // offer a 356px rail on a 390px screen. And a caller with nothing to switch
  // to (the notebook — see PageScreen) withholds the handler entirely, so the
  // rail draws no control it cannot honour.
  it("draws no shape control in the sheet, or when the caller offers none", () => {
    renderRail({ presentation: "sheet", onShapeChange: vi.fn() });
    expect(screen.queryByRole("button", { name: /Dock to the side|Float it free/ })).toBeNull();
    cleanup();
    renderRail({ presentation: "floating" });
    expect(screen.queryByRole("button", { name: /Dock to the side|Float it free/ })).toBeNull();
  });

  // Until a drag moves it, the panel keeps `.assistant-float`'s own
  // `right: 16px; bottom: 16px` — which is what holds §9's planted
  // bottom-right corner through a resize with no JavaScript running at all.
  it("adopts no position until it is dragged", () => {
    setViewport(1440, 900);
    renderRail({ presentation: "floating", onShapeChange: vi.fn() });
    expect(positionOf()).toEqual({ left: "", top: "" });
  });

  it("moves by the pointer's delta when its header is dragged", () => {
    setViewport(1440, 900);
    renderRail({ presentation: "floating", onShapeChange: vi.fn() });
    // `.assistant-float`'s own corner on this viewport: 1440-364-16 = 1060,
    // 900-476-16 = 408.
    placePanelAt(1060, 408);

    dragHeaderBy(-200, -100);
    expect(positionOf()).toEqual({ left: "860px", top: "308px" });
  });

  it("clamps to §9's 16px pad rather than letting the panel leave the screen", () => {
    setViewport(1440, 900);
    renderRail({ presentation: "floating", onShapeChange: vi.fn() });

    dragHeaderBy(-99999, -99999);
    expect(positionOf()).toEqual({ left: "16px", top: "16px" });
  });

  // §9: "re-clamped on resize. A narrow window no longer evicts the assistant."
  it("re-clamps a dragged panel when the window shrinks", () => {
    setViewport(1440, 900);
    renderRail({ presentation: "floating", onShapeChange: vi.fn() });
    placePanelAt(1060, 408);
    // A drag that does not move still adopts the position, which is what the
    // resize below then has something to re-clamp.
    dragHeaderBy(0, 0);
    expect(positionOf()).toEqual({ left: "1060px", top: "408px" });

    act(() => {
      setViewport(900, 700);
      window.dispatchEvent(new Event("resize"));
    });
    // 900-364-16 = 520, 700-476-16 = 208.
    expect(positionOf()).toEqual({ left: "520px", top: "208px" });
  });

  // §9: "Docked is ... the only mode where dragging is off (cursor `default`)."
  //
  // **Asserted after switching to floating**, because a docked panel carries no
  // inline position either way — the style is only applied while floating, so
  // the obvious version of this test passed with the `isFloating` guard on the
  // drag removed. It was watched to do exactly that (CLAUDE.md rule 3). What
  // this holds instead is that a drag attempted while docked ADOPTED nothing:
  // if it had, the panel would jump to that stale point the moment it floats.
  it("does not drag while docked, and carries no stale position into floating", () => {
    setViewport(1440, 900);
    const { rerender } = renderRail({ presentation: "docked", onShapeChange: vi.fn() });
    dragHeaderBy(-200, -100);
    expect(positionOf()).toEqual({ left: "", top: "" });

    rerender(
      <AssistantRail {...baseProps} presentation="floating" onShapeChange={vi.fn()} />,
    );
    expect(positionOf()).toEqual({ left: "", top: "" });
  });

  // The whole header is the drag handle, so without stopping propagation a
  // press on the Dock button starts a drag and the click that follows lands on
  // a panel that has already moved under the pointer.
  it("pressing the shape control does not drag the panel", () => {
    setViewport(1440, 900);
    const onShapeChange = vi.fn();
    renderRail({ presentation: "floating", onShapeChange });

    const control = screen.getByRole("button", { name: "Dock to the side" });
    fireEvent.pointerDown(control, { button: 0, clientX: 1200, clientY: 400 });
    fireEvent.pointerMove(window, { clientX: 1000, clientY: 300 });
    fireEvent.pointerUp(window);

    expect(positionOf()).toEqual({ left: "", top: "" });
  });
});

// SPEC §29, M26 link 10c: "On `plans` the floating dock keeps its place in the
// tree with `visibility: hidden; pointer-events: none` … unmounting it loses
// the thread, the open/closed state and the dragged position, so coming back
// from Plans would reset it."
//
// There is nothing in that route's tree to hide — `/plans` renders neither the
// board nor the trip — so the RESULT is delivered by outliving the unmount
// instead: the thread already did (`persistAs`), the shape does, and the
// position does through this key. An unmount and remount is exactly what the
// trip to Plans and back is.
describe("AssistantRail — the dragged position survives leaving the route", () => {
  const KEY = "assistant:position:trip:x";

  afterEach(() => {
    window.localStorage.clear();
  });

  function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  }

  function positionOf(): { left: string; top: string } {
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    return { left: panel.style.left, top: panel.style.top };
  }

  function dragTo(x: number, y: number) {
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    panel.getBoundingClientRect = () =>
      ({ left: 1060, top: 408, width: 364, height: 476, right: 1424, bottom: 884, x: 1060, y: 408 }) as DOMRect;
    fireEvent.pointerDown(screen.getByTestId("assistant-header"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: x - 1060, clientY: y - 408 });
    fireEvent.pointerUp(window);
  }

  it("comes back where it was left, after an unmount", () => {
    setViewport(1440, 900);
    const first = renderRail({
      presentation: "floating",
      onShapeChange: vi.fn(),
      rememberPositionAs: KEY,
    });
    dragTo(400, 200);
    expect(positionOf()).toEqual({ left: "400px", top: "200px" });

    // The trip to Plans and back.
    first.unmount();
    renderRail({ presentation: "floating", onShapeChange: vi.fn(), rememberPositionAs: KEY });
    expect(positionOf()).toEqual({ left: "400px", top: "200px" });
  });

  it("forgets it when the caller asks for no memory, which is what used to happen", () => {
    setViewport(1440, 900);
    const first = renderRail({ presentation: "floating", onShapeChange: vi.fn() });
    dragTo(400, 200);
    expect(positionOf()).toEqual({ left: "400px", top: "200px" });

    first.unmount();
    renderRail({ presentation: "floating", onShapeChange: vi.fn() });
    expect(positionOf()).toEqual({ left: "", top: "" });
  });

  it("keeps two surfaces' positions apart", () => {
    setViewport(1440, 900);
    const trip = renderRail({
      presentation: "floating",
      onShapeChange: vi.fn(),
      rememberPositionAs: KEY,
    });
    dragTo(400, 200);
    trip.unmount();

    renderRail({
      presentation: "floating",
      onShapeChange: vi.fn(),
      rememberPositionAs: "assistant:position:page:y",
    });
    expect(positionOf()).toEqual({ left: "", top: "" });
  });

  it("ignores stored rubbish rather than positioning the panel with it", () => {
    setViewport(1440, 900);
    window.localStorage.setItem(KEY, "{ not json");
    renderRail({ presentation: "floating", onShapeChange: vi.fn(), rememberPositionAs: KEY });
    expect(positionOf()).toEqual({ left: "", top: "" });

    // A string, a null, a missing field, and the `NaN` that survives
    // `JSON.parse` as `null` — each would position the panel nowhere.
    for (const bad of [{ x: "left", y: null }, { x: 10 }, { y: 10 }, { x: 10, y: Infinity }]) {
      cleanup();
      window.localStorage.setItem(KEY, JSON.stringify(bad));
      renderRail({ presentation: "floating", onShapeChange: vi.fn(), rememberPositionAs: KEY });
      expect(positionOf(), JSON.stringify(bad)).toEqual({ left: "", top: "" });
    }
  });
});

// KI-2026-10-12-g: a reply that leaves the page, or a reload, unmounts the
// rail with whatever was typed while it answered. The draft is kept per
// conversation, so it comes back on the next mount under the same name.
describe("AssistantRail — the unsent draft survives an unmount", () => {
  afterEach(() => window.localStorage.clear());

  const composer = () => screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;

  it("puts back what was typed under the same conversation, and only there", async () => {
    const first = renderRail({ rememberDraftAs: "trip:a" });
    fireEvent.change(composer(), { target: { value: "and the second day?" } });
    first.unmount();

    const again = renderRail({ rememberDraftAs: "trip:a" });
    await waitFor(() => expect(composer().value).toBe("and the second day?"));
    again.unmount();

    renderRail({ rememberDraftAs: "trip:b" });
    expect(composer().value).toBe("");
  });

  // At once, not after the save's delay: a reload inside it runs no cleanup,
  // and would bring back a question already asked.
  it("forgets the draft the moment it is sent", async () => {
    const onAsk = vi.fn();
    const first = renderRail({ rememberDraftAs: "trip:a" });
    fireEvent.change(composer(), { target: { value: "and the second day?" } });
    first.unmount();
    renderRail({ onAsk, rememberDraftAs: "trip:a" });
    await waitFor(() => expect(composer().value).toBe("and the second day?"));

    fireEvent.click(screen.getByRole("button", { name: "Ask the assistant" }));
    await waitFor(() => expect(composer().value).toBe(""));
    expect(onAsk).toHaveBeenCalledWith("and the second day?");
    expect(loadAskDraft(ownedAskName("user-a", "trip:a"))).toBeNull();
  });

  // The owned name exists only once the session read answers; what was typed
  // before then is this conversation's draft, and is stored once it does.
  it("stores what was typed before the session answered, once it does", async () => {
    session.user = undefined;
    const view = renderRail({ rememberDraftAs: "account" });
    fireEvent.change(composer(), { target: { value: "where next?" } });
    session.user = { id: "user-a" };
    view.rerender(<AssistantRail {...baseProps} rememberDraftAs="account" />);
    expect(composer().value).toBe("where next?");
    await waitFor(() => expect(loadAskDraft(ownedAskName("user-a", "account"))).toBe("where next?"));
  });

  // PR 426 review, finding 8: a rail handed another conversation's name took
  // the old one's text along and, a moment later, stored it under the new name.
  it("swaps the box to the other conversation's draft when the name changes", () => {
    const view = renderRail({ rememberDraftAs: "trip:a" });
    fireEvent.change(composer(), { target: { value: "and the second day?" } });
    view.rerender(<AssistantRail {...baseProps} rememberDraftAs="trip:b" />);
    expect(composer().value).toBe("");
    expect(loadAskDraft(ownedAskName("user-a", "trip:a"))).toBe("and the second day?");
    expect(loadAskDraft(ownedAskName("user-a", "trip:b"))).toBeNull();
  });

  // PR 426 review, finding 1: another account on this browser must not find
  // this one's unsent question in its box.
  it("keeps one account's draft out of another's box", async () => {
    const first = renderRail({ rememberDraftAs: "account" });
    fireEvent.change(composer(), { target: { value: "and the second day?" } });
    first.unmount();

    session.user = { id: "user-b" };
    const other = renderRail({ rememberDraftAs: "account" });
    // Effects flushed by `render`'s act, so a restore would already be here.
    expect(composer().value).toBe("");
    other.unmount();

    session.user = { id: "user-a" };
    renderRail({ rememberDraftAs: "account" });
    await waitFor(() => expect(composer().value).toBe("and the second day?"));
  });
});

// PR 426 review round 2, finding 2: Home reached by a client-side navigation
// already knows who is signed in. Below 1100px a docked rail mounted on the
// first render's width guess and, unmounting a frame later, flushed its empty
// box over the draft the sheet had stored.
describe("Home's assistant — the stored draft survives a mount below 1100px", () => {
  afterEach(() => {
    window.localStorage.clear();
    setViewportMatches({});
  });

  it.each([
    ["a phone", { "(max-width: 767px)": true }],
    ["768-1099px", { "(min-width: 768px) and (max-width: 1099px)": true }],
  ])("at %s", async (_width, matches) => {
    setViewportMatches(matches);
    saveAskDraft(ownedAskName("user-a", "account"), "where should I go next");
    render(<BeyondTripAssistant scope={{ kind: "account" }} />);
    // Past the save's delay, so a save armed on the first render has fired.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(loadAskDraft(ownedAskName("user-a", "account"))).toBe("where should I go next");
  });
});

// M45 D7: Home's rail answers across every trip.
describe("AssistantRail — the account scope", () => {
  it("asks about your trips, with its own hint, when the scope is the account", () => {
    renderRail({ scope: { kind: "account" }, contextLine: "Across your trips" });
    expect(screen.getByPlaceholderText("Ask about your trips…")).not.toBeNull();
    expect(screen.queryByText("Ask about this trip and the conversation stays here.")).toBeNull();
  });

  it("draws no Hide when the caller offers no way to hide it", () => {
    render(<AssistantRail {...baseProps} onHide={undefined} />);
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
  });
});

// M45 D6: ⌘K's *Ask: <text>* hands its text to the rail, which sends it the
// way its own Ask button would, once.
describe("AssistantRail — text handed in from ⌘K", () => {
  // In StrictMode, whose second effect run is what the rail's own guard is
  // for (PR 426 review, finding 6): without it, one hand-off asks twice.
  it("sends it once, and a second hand-off of the same words sends again", () => {
    const onAsk = vi.fn();
    const onIncomingTaken = vi.fn();
    const props = { ...baseProps, onAsk, onIncomingTaken };
    const view = render(
      <StrictMode>
        <AssistantRail {...props} incoming={{ text: "which city have I been to most?" }} />
      </StrictMode>,
    );
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith("which city have I been to most?");
    view.rerender(
      <StrictMode>
        <AssistantRail {...props} incoming={{ text: "which city have I been to most?" }} />
      </StrictMode>,
    );
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  // PR 426 review, finding 3: the caller drops the hand-off once taken, so a
  // rail that remounts does not find it and ask it again.
  it("tells the caller it has taken the hand-off", () => {
    const onIncomingTaken = vi.fn();
    renderRail({ incoming: { text: "which city have I been to most?" }, onIncomingTaken });
    expect(onIncomingTaken).toHaveBeenCalledTimes(1);
  });

  // PR 426 review, finding 2: the box may hold a follow-up typed while the
  // turn answers (KI-2026-09-07-c). A hand-off that has to wait, or is
  // refused, goes in after it rather than over it.
  it("keeps what was already typed when the hand-off has to wait", () => {
    const props = { ...baseProps, asking: true, onAsk: vi.fn() };
    const view = render(<AssistantRail {...props} />);
    const box = screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "and dinner that night?" } });
    view.rerender(<AssistantRail {...props} incoming={{ text: "book a hotel near Gion" }} />);
    expect(box.value).toBe("and dinner that night? book a hotel near Gion");
  });

  it("keeps what was already typed when the hand-off is refused", async () => {
    const props = { ...baseProps, onAsk: vi.fn(async () => false) };
    const view = render(<AssistantRail {...props} />);
    const box = screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "and dinner that night?" } });
    view.rerender(<AssistantRail {...props} incoming={{ text: "book a hotel near Gion" }} />);
    await waitFor(() => expect(box.value).toBe("and dinner that night? book a hotel near Gion"));
  });

  // M52 decision 15: a notebook's *Ask* chip opens the sheet with its question
  // filled in, for the reader to finish ("by 30 minutes") before it costs a turn.
  it("only fills the composer with a hand-off marked prefill, and sends nothing", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk, incoming: { text: "We're running late.", prefill: true } });
    expect(onAsk).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).value).toBe("We're running late.");
  });

  // PR 537 review round 2 (m3): a reader who taps *Running late*, then *Move
  // dinner later*, has chosen the second question, not asked both in one turn.
  it("replaces a prefilled question with the next one", () => {
    const { rerender } = renderRail({ incoming: { text: "We're running late.", prefill: true } });
    rerender(<AssistantRail {...baseProps} incoming={{ text: "Move dinner later.", prefill: true }} />);
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).value).toBe("Move dinner later.");
  });

  // PR 537 review round 2 (m4): a chip pressed beside an open docked rail left
  // focus on the chip, so a keyboard reader had to find the composer to finish.
  it("moves focus into an open rail's composer, at the end of the prefilled question", () => {
    const { rerender } = render(
      <>
        <button type="button">Running late</button>
        <AssistantRail {...baseProps} />
      </>,
    );
    screen.getByRole("button", { name: "Running late" }).focus();
    rerender(
      <>
        <button type="button">Running late</button>
        <AssistantRail {...baseProps} incoming={{ text: "We're running late.", prefill: true }} />
      </>,
    );
    const box = screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;
    expect(box.matches(":focus")).toBe(true);
    expect(box.selectionStart).toBe(box.value.length);
  });

  it("leaves it waiting in the composer while a turn is answering", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk, asking: true, incoming: { text: "and where next?" } });
    expect(onAsk).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).value).toBe("and where next?");
  });
});

// PR 426 review round 4, finding 3: opening moves focus into the composer,
// once. The board's rail remounts while open (its header reload), and a
// remount that took focus again would pull it from wherever the reader is.
describe("AssistantRail — focus on open, from useAssistantVisibility", () => {
  function Surface() {
    const assistant = useAssistantVisibility();
    const [mount, setMount] = useState(0);
    return (
      <>
        <button type="button" onClick={assistant.show}>
          Ask
        </button>
        <button type="button" onClick={() => setMount((n) => n + 1)}>
          Remount
        </button>
        <input aria-label="Elsewhere" />
        {assistant.open ? (
          <AssistantRail key={mount} {...baseProps} takeFocus={assistant.takeFocus} onHide={assistant.hide} />
        ) : null}
      </>
    );
  }

  it("takes focus when opened, and not when it remounts while open", async () => {
    render(<Surface />);
    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    // The keys go wherever focus is, as they do for a keyboard user.
    await userEvent.keyboard("a");
    const composer = () => screen.getByPlaceholderText<HTMLInputElement>(/ask about this day/i);
    expect(composer().value).toBe("a");

    await userEvent.click(screen.getByRole("textbox", { name: "Elsewhere" }));
    // `fireEvent`, not `userEvent`: a real click would move focus to the button.
    fireEvent.click(screen.getByRole("button", { name: "Remount" }));
    await userEvent.keyboard("b");
    expect((screen.getByRole("textbox", { name: "Elsewhere" }) as HTMLInputElement).value).toBe("b");
    expect(composer().value).toBe("");
  });

  // M46's preview walk: ⌘K's *Open chat* or *Ask* on a panel already open
  // hid the tab focus was in and left it on <body>. The new tab takes it; a
  // tab chosen in the strip keeps it, as tabs do.
  it("moves focus into the tab ⌘K switches to, and leaves it on a tab clicked", async () => {
    const chatOn = (tab: "ask" | "chat") => ({ tab, onTabChange: vi.fn(), panel: <input aria-label="Message" /> });
    const { rerender } = render(<AssistantRail {...baseProps} chat={chatOn("ask")} />);
    const composer = screen.getByPlaceholderText<HTMLInputElement>(/ask about this day/i);
    composer.focus();

    rerender(<AssistantRail {...baseProps} chat={chatOn("chat")} />);
    expect(screen.getByRole("textbox", { name: "Message" }).matches(":focus")).toBe(true);

    screen.getByRole("tab", { name: "Ask" }).focus();
    fireEvent.click(screen.getByRole("tab", { name: "Ask" }));
    rerender(<AssistantRail {...baseProps} chat={chatOn("ask")} />);
    expect(screen.getByRole("tab", { name: "Ask" }).matches(":focus")).toBe(true);
  });

  // The chat's first read waits for idle, and its composer for that read:
  // Chat opened sooner puts focus on the panel, and it moves on to the
  // composer when the read lands, but never away from where the person put it.
  describe("Chat opened before its first read", () => {
    const reading = { tab: "chat" as const, onTabChange: vi.fn(), panel: null, ready: false };
    const read = { ...reading, panel: <input aria-label="Message" />, ready: true };
    const mount = () =>
      render(
        <>
          <input aria-label="Elsewhere" />
          <AssistantRail {...baseProps} takeFocus={() => true} chat={reading} />
        </>,
      );
    const remount = (rerender: (ui: React.ReactNode) => void) =>
      rerender(
        <>
          <input aria-label="Elsewhere" />
          <AssistantRail {...baseProps} takeFocus={() => true} chat={read} />
        </>,
      );

    it("moves focus from the panel to the composer once the chat is read", () => {
      const { rerender } = mount();
      expect(screen.getByRole("tabpanel").matches(":focus")).toBe(true);
      remount(rerender);
      expect(screen.getByRole("textbox", { name: "Message" }).matches(":focus")).toBe(true);
    });

    it("leaves focus the person moved meanwhile where it is", () => {
      const { rerender } = mount();
      screen.getByRole("textbox", { name: "Elsewhere" }).focus();
      remount(rerender);
      expect(screen.getByRole("textbox", { name: "Elsewhere" }).matches(":focus")).toBe(true);
    });

    // PR 442: a sheet's composer taking focus raises the phone's keyboard
    // over it, so a read landing under a sheet leaves focus on the panel.
    it("leaves a sheet's focus on the panel when the read lands", () => {
      const sheet = (chat: typeof reading | typeof read) => (
        <AssistantRail {...baseProps} presentation="sheet" onHide={vi.fn()} takeFocus={() => true} chat={chat} />
      );
      const { rerender } = render(sheet(reading));
      screen.getByRole("tabpanel").focus();
      rerender(sheet(read));
      expect(screen.getByRole("tabpanel").matches(":focus")).toBe(true);
    });
  });

  // Mitchell's M46 walk: "Lets keep home card with the full count, the rest
  // as just the unread dot". The tab's name keeps the count.
  it.each([
    [1, "Chat, 1 unread message"],
    [12, "Chat, 12 unread messages"],
    [120, "Chat, 120 unread messages"],
  ])("marks %i unread on the Chat tab with a dot and no count, and still names them", (unread, name) => {
    render(<AssistantRail {...baseProps} chat={{ tab: "ask", onTabChange: vi.fn(), panel: null, unread }} />);
    const tab = screen.getByRole("tab", { name });
    expect(tab.textContent).toBe("Chat");
    expect(within(tab).getByTestId("unread-dot").getAttribute("aria-hidden")).toBe("true");
  });

  // PR 442 review, finding 2: Safari does not focus a button it taps, so a
  // tap on a tab left focus off the strip and the switch focused the composer,
  // raising the phone's keyboard over the sheet. `fireEvent` clicks as Safari
  // does, without moving focus. The tap is spent on its own switch: a later
  // one from outside the strip, as ⌘K's *Ask* makes, still moves focus.
  it("leaves focus alone when a tab in the sheet is tapped, and not on the next switch", () => {
    function Sheet() {
      const [tab, setTab] = useState<"ask" | "chat">("ask");
      // The palette sits behind the sheet's modal; a control in the panel
      // stands in for it, a switch that does not come through the strip.
      const panel = (
        <>
          <input aria-label="Message" />
          <button type="button" onClick={() => setTab("ask")}>
            Palette Ask
          </button>
        </>
      );
      return <AssistantRail {...baseProps} presentation="sheet" onHide={vi.fn()} chat={{ tab, onTabChange: setTab, panel }} />;
    }
    render(<Sheet />);
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Message" }).matches(":focus")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Palette Ask" }));
    expect(screen.getByPlaceholderText(/ask about this day/i).matches(":focus")).toBe(true);
  });
});
