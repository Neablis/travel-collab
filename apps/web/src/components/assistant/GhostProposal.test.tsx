import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Preview } from "@/components/ui/preview";
import { GhostProposal, type Proposal } from "./GhostProposal";

afterEach(cleanup);

const proposal: Proposal = {
  id: "g1",
  title: "Add teamLab Planets",
  why: "You have a free afternoon in Odaiba and it's a 20-minute train from your last stop.",
  start: "14:00",
  end: "16:00",
};

describe("GhostProposal", () => {
  it("renders the proposal title and why, plus Keep/Discard, inside the timeline-ghost Preview region", () => {
    render(
      <Preview id="timeline-ghost" size="container">
        <GhostProposal proposal={proposal} onKeep={vi.fn()} onDiscard={vi.fn()} />
      </Preview>,
    );
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    const region = document.querySelector('[data-preview-id="timeline-ghost"]');
    expect(region).not.toBeNull();
    const scoped = within(region as HTMLElement);
    expect(scoped.getByText("Add teamLab Planets")).not.toBeNull();
    expect(scoped.getByText(/free afternoon in Odaiba/)).not.toBeNull();
    expect(scoped.getByRole("button", { name: "Keep" })).not.toBeNull();
    expect(scoped.getByRole("button", { name: "Discard" })).not.toBeNull();
  });

  it("is genuinely inert: Keep/Discard do not fire when wrapped in Preview (pointer-events shielded)", async () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(
      <Preview id="timeline-ghost" size="container">
        <GhostProposal proposal={proposal} onKeep={onKeep} onDiscard={onDiscard} />
      </Preview>,
    );
    await expect(
      userEvent.click(screen.getByRole("button", { name: "Keep" })),
    ).rejects.toThrow();
    expect(onKeep).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("calls onKeep/onDiscard with the proposal id when rendered unwrapped (real handler wiring)", async () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<GhostProposal proposal={proposal} onKeep={onKeep} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onKeep).toHaveBeenCalledWith("g1");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledWith("g1");
  });
});
