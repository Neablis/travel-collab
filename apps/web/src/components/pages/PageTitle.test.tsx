import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageTitle } from "./PageTitle";

afterEach(cleanup);

// The rename surface itself, tested here rather than through `PageScreen`.
//
// The empty-title guard in particular has nowhere else it can fail:
// `PageScreen` puts the old name back when the request errors, and an empty
// title is exactly what the API refuses — so a `PageScreen` test asserting "the
// old title is still on screen" passes with the guard deleted, for the wrong
// reason. That test was written, seen to pass with the guard removed, and moved
// here.
describe("PageTitle", () => {
  const renameTo = (next: string) => {
    const heading = screen.getByRole("heading", { level: 1 });
    heading.textContent = next;
    // `focusout`, not `blur`: React routes `onBlur` through the bubbling
    // `focusout` event, so a dispatched `blur` reaches no handler at all.
    fireEvent.focusOut(heading);
    return heading;
  };

  it("takes no caret when the page is not being edited", () => {
    render(<PageTitle title="Trip Overview" editable={false} onRename={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("contenteditable")).toBe("false");
  });

  it("renames on blur, once, with the trimmed text", () => {
    const onRename = vi.fn();
    render(<PageTitle title="Trip Overview" editable onRename={onRename} />);

    renameTo("  Kyoto notes  ");

    expect(onRename).toHaveBeenCalledExactlyOnceWith("Kyoto notes");
  });

  it("says nothing when the text comes back unchanged", () => {
    const onRename = vi.fn();
    render(<PageTitle title="Trip Overview" editable onRename={onRename} />);

    renameTo("Trip Overview");

    expect(onRename).not.toHaveBeenCalled();
  });

  it("refuses an empty title and puts the old one back", () => {
    const onRename = vi.fn();
    render(<PageTitle title="Trip Overview" editable onRename={onRename} />);

    const heading = renameTo("   ");

    expect(onRename).not.toHaveBeenCalled();
    // Restored in the DOM, not merely un-sent: React does not own this text, so
    // nothing else would put it back.
    expect(heading.textContent).toBe("Trip Overview");
  });

  it("abandons the edit on Escape", () => {
    const onRename = vi.fn();
    render(<PageTitle title="Trip Overview" editable onRename={onRename} />);
    const heading = screen.getByRole("heading", { level: 1 });

    heading.textContent = "Half a name";
    fireEvent.keyDown(heading, { key: "Escape" });
    fireEvent.focusOut(heading);

    expect(onRename).not.toHaveBeenCalled();
    expect(heading.textContent).toBe("Trip Overview");
  });
});
