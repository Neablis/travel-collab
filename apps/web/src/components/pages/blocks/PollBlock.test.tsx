import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PollPayload, PollResults } from "@tc/pages";
import { FixedPeopleProvider } from "../people";
import { PollBlock } from "./PollBlock";

// "Poll" (M58 decision 8) as each reader sees it. What the votes MEAN is
// `votes.int.test.ts`'s; this holds what only the screen decides: that a
// member votes and sees names, that an editor alone can close, that a closed
// poll takes no vote, and that a stranger is shown counts and no control.

const POLL_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const options = [{ id: "Ramen", label: "Ramen" }, { id: "Sushi", label: "Sushi" }, { id: "Tempura", label: "Tempura" }];
const member: PollPayload = { kind: "poll", pollId: POLL_ID, question: "Where to eat?", options, multi: false, closesAt: null, counts: null, closed: null };
const stranger: PollPayload = { ...member, pollId: null, counts: { Ramen: 3, Sushi: 1, Tempura: 0 }, closed: false };

const person = (name: string) => ({ name, travelling: true, avatar: null, color: null, colorShifted: false });
const people = { ann: person("Ann"), bob: person("Bob"), cat: person("Cat") };

const open: PollResults = { closed: false, counts: { Ramen: 1, Sushi: 1, Tempura: 0 }, votes: [{ userId: "ann", optionIds: ["Ramen"] }, { userId: "bob", optionIds: ["Sushi"] }], mine: [], canClose: true, datePassed: false };

const answer = (body: PollResults, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draw = (payload: PollPayload, interactive = true) =>
  render(
    <FixedPeopleProvider personas={people}>
      <PollBlock payload={payload} tripId={TRIP_ID} interactive={interactive} />
    </FixedPeopleProvider>,
  );

describe("PollBlock for a member", () => {
  it("names who voted for what, and who has not voted yet", async () => {
    fetchMock.mockResolvedValueOnce(answer(open));
    draw(member);
    expect(await screen.findByText("Not voted yet: Cat")).toBeTruthy();
    const ramen = screen.getByRole("button", { name: /Ramen/ });
    expect(within(ramen).getByText("Ann")).toBeTruthy();
    expect(fetchMock.mock.calls[0]![0]).toContain(`/api/trips/${TRIP_ID}/polls/${POLL_ID}`);
  });

  it("sends a vote when an option is chosen and shows the answer", async () => {
    fetchMock.mockResolvedValueOnce(answer(open));
    draw(member);
    await screen.findByText("Not voted yet: Cat");
    fetchMock.mockResolvedValueOnce(answer({ ...open, counts: { Ramen: 1, Sushi: 1, Tempura: 1 }, votes: [...open.votes, { userId: "cat", optionIds: ["Tempura"] }], mine: ["Tempura"] }));
    await userEvent.click(screen.getByRole("button", { name: /Tempura/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Tempura/ }).getAttribute("aria-pressed")).toBe("true"));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain(`/polls/${POLL_ID}`);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ optionIds: ["Tempura"] }) });
    expect(screen.queryByText(/Not voted yet/)).toBeNull();
  });

  it("adds a pick on a poll that takes several, and keeps the last pick rather than send none", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, mine: ["Ramen"] }));
    draw({ ...member, multi: true });
    await screen.findByText("Not voted yet: Cat");
    fetchMock.mockResolvedValueOnce(answer({ ...open, mine: ["Ramen", "Sushi"] }));
    await userEvent.click(screen.getByRole("button", { name: /Sushi/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "PUT", body: JSON.stringify({ optionIds: ["Ramen", "Sushi"] }) });
    await waitFor(() => expect(screen.getByRole("button", { name: /Sushi/ }).getAttribute("aria-pressed")).toBe("true"));
    // Un-picking Sushi leaves Ramen; with Ramen the only one left, tapping it sends nothing.
    fetchMock.mockResolvedValueOnce(answer({ ...open, mine: ["Ramen"] }));
    await userEvent.click(screen.getByRole("button", { name: /Sushi/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Sushi/ }).getAttribute("aria-pressed")).toBe("false"));
    await userEvent.click(screen.getByRole("button", { name: /Ramen/ }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("offers the editor the close button the server says they may use, and then takes no more votes", async () => {
    fetchMock.mockResolvedValueOnce(answer(open));
    draw(member);
    const closer = await screen.findByRole("button", { name: "Close poll" });
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true }));
    await userEvent.click(closer);
    await screen.findByText("Poll closed");
    expect(fetchMock.mock.calls[1]![0]).toContain(`/polls/${POLL_ID}/close`);
    expect(screen.queryByRole("button", { name: "Close poll" })).toBeNull();
    expect(screen.getByRole("button", { name: /Ramen/ }).hasAttribute("disabled")).toBe(true);
  });

  it("offers the editor Reopen poll on a closed poll, announces it, and takes votes again", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true }));
    draw(member);
    const reopener = await screen.findByRole("button", { name: "Reopen poll" });
    expect(screen.queryByRole("button", { name: "Close poll" })).toBeNull();
    fetchMock.mockResolvedValueOnce(answer(open));
    await userEvent.click(reopener);
    await screen.findByRole("button", { name: "Close poll" });
    expect(fetchMock.mock.calls[1]![0]).toContain(`/polls/${POLL_ID}/reopen`);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST" });
    expect(screen.getByRole("status").textContent).toBe("You reopened the poll.");
    expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
    expect(screen.getByRole("button", { name: /Ramen/ }).hasAttribute("disabled")).toBe(false);
  });

  it("announces that the poll closed", async () => {
    fetchMock.mockResolvedValueOnce(answer(open));
    draw(member);
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Close poll" }));
    await screen.findByRole("button", { name: "Reopen poll" });
    expect(screen.getByRole("status").textContent).toBe("You closed the poll.");
  });

  it("keeps focus on the poll after Close and after Reopen, rather than dropping it to the page", async () => {
    fetchMock.mockResolvedValueOnce(answer(open));
    draw(member);
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Close poll" }));
    await screen.findByRole("button", { name: "Reopen poll" });
    expect(screen.getByRole("heading", { name: "Where to eat?" }).matches(":focus")).toBe(true);
    fetchMock.mockResolvedValueOnce(answer(open));
    await userEvent.click(screen.getByRole("button", { name: "Reopen poll" }));
    await screen.findByRole("button", { name: "Close poll" });
    expect(screen.getByRole("heading", { name: "Where to eat?" }).matches(":focus")).toBe(true);
  });

  it("re-reads when Reopen is refused because the date passed, so the note replaces the button at once", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true }));
    draw({ ...member, closesAt: "2026-11-01" });
    const reopener = await screen.findByRole("button", { name: "Reopen poll" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "The close date has passed. Move it to reopen the poll.", code: "poll-date-passed" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true, datePassed: true }));
    await userEvent.click(reopener);
    expect(await screen.findByText("The close date has passed — move it to reopen the poll.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
    // R3: the pressed button is gone, so focus goes to the heading. R4: the date note says it, so no alert repeats it.
    expect(screen.getByRole("heading", { name: "Where to eat?" }).matches(":focus")).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no Reopen poll to a viewer or a suggester", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true, canClose: false }));
    draw(member);
    await screen.findByText("Poll closed");
    expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
  });

  it("says the date must move, instead of offering Reopen poll, when the close date has passed", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, closed: true, datePassed: true }));
    draw({ ...member, closesAt: "2026-11-01" });
    expect(await screen.findByText("The close date has passed — move it to reopen the poll.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
  });

  it("offers a viewer the vote and no way to close", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...open, canClose: false }));
    draw(member);
    await screen.findByText("Not voted yet: Cat");
    expect(screen.getByRole("button", { name: /Ramen/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close poll" })).toBeNull();
  });
});

describe("PollBlock for a stranger", () => {
  it("shows the question and each count, with no control and no read of the votes", () => {
    draw(stranger, false);
    expect(screen.getByText("Where to eat?")).toBeTruthy();
    const [ramen, sushi] = screen.getAllByRole("listitem");
    expect(within(ramen!).getByText("Ramen")).toBeTruthy();
    expect(within(ramen!).getByText("3")).toBeTruthy();
    expect(within(sushi!).getByText("1")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByText(/Not voted yet/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when the poll is closed", () => {
    draw({ ...stranger, closed: true }, false);
    expect(screen.getByText("Poll closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen poll" })).toBeNull();
  });
});

describe("PollBlock while the page is being edited", () => {
  it("draws the poll and reads no votes, so no control competes with selecting the widget", () => {
    draw(member, false);
    expect(screen.getByText("Where to eat?")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
