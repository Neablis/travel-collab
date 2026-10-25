import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dragToPosition, RepositionCover } from "./RepositionCover";

// M49 decision 10: the band's reposition mode. Each test drives the control
// as a person would and reads the position off the slider it exposes.

function renderAt(position: number) {
  const onChange = vi.fn();
  const onSave = vi.fn(async () => true);
  const onCancel = vi.fn();
  render(<RepositionCover initial={position} onChange={onChange} onSave={onSave} onCancel={onCancel} />);
  const slider = screen.getByRole("slider", { name: "Cover position" });
  const at = () => Number(slider.getAttribute("aria-valuenow"));
  return { slider, at, onChange, onSave, onCancel };
}

describe("dragToPosition", () => {
  it("follows the pointer: down shows more of the top, up more of the bottom, held to 0–100", () => {
    // 384px of travel: a quarter of it is 25 points.
    expect(dragToPosition(50, 96, 384)).toBe(25);
    expect(dragToPosition(50, -96, 384)).toBe(75);
    expect(dragToPosition(50, 1000, 384)).toBe(0);
    expect(dragToPosition(50, -1000, 384)).toBe(100);
  });
});

describe("RepositionCover", () => {
  beforeEach(() => {
    // jsdom lays nothing out: the band is 384px tall here, with no photo
    // measured, so a drag's travel is the band's height.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 384 }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("moves the photo with a drag, live, and keeps it where the drag let go", () => {
    const { slider, at, onChange, onSave } = renderAt(50);
    fireEvent.pointerDown(slider, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientY: 196, pointerId: 1 });
    // Before the release: the band is already showing it.
    expect(at()).toBe(25);
    expect(onChange).toHaveBeenLastCalledWith(25);
    fireEvent.pointerUp(slider, { clientY: 196, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientY: 400, pointerId: 1 });
    expect(at()).toBe(25);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("moves 1% per arrow and 10% with Shift, held to 0–100", async () => {
    const { slider, at } = renderAt(95);
    expect(slider.matches(":focus")).toBe(true);
    await userEvent.keyboard("{ArrowUp}");
    expect(at()).toBe(96);
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(at()).toBe(100);
    await userEvent.keyboard("{ArrowDown}");
    expect(at()).toBe(99);
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(at()).toBe(89);
  });

  it("holds at 0 going down", async () => {
    const { at } = renderAt(3);
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(at()).toBe(0);
  });

  it("reverts on Esc, saving nothing", async () => {
    const { at, onCancel, onSave } = renderAt(50);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(at()).toBe(52);
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the moved position on Enter, and on Save position", async () => {
    const { onSave } = renderAt(50);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSave).toHaveBeenLastCalledWith(49);
    await userEvent.click(screen.getByRole("button", { name: "Save position" }));
    expect(onSave).toHaveBeenLastCalledWith(49);
  });

  it("says so and stays open when the save fails", async () => {
    const { onSave } = renderAt(50);
    onSave.mockResolvedValue(false);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Cover position" }).getAttribute("aria-valuenow")).toBe("51");
  });
});
