import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageContent } from "@tc/contracts";
import { tripDetailFixture } from "@/mocks/fixtures";
import { PageEditor } from "./PageEditor";

afterEach(cleanup);

// jsdom has no layout engine, so ProseMirror's coordinate-based cursor
// placement (`posAtCoords`/`coordsAtPos`, used on every click/mousedown into
// the editor) throws on `elementFromPoint`/`getClientRects`, which don't
// exist in jsdom. Stub both so `userEvent.type`'s click-then-type sequence
// can place a cursor without a real layout — every other browser API stays
// real; only the geometry ProseMirror needs is faked.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const detail = tripDetailFixture();
const context = { tripId: detail.tripId };

describe("PageEditor", () => {
  it("offers no macro autocomplete", async () => {
    render(
      <PageEditor
        detail={detail}
        context={context}
        value={{ type: "doc", content: [{ type: "paragraph", content: [] }] }}
        onChange={() => {}}
      />,
    );
    // userEvent's `{` starts a special-key escape sequence (e.g. `{enter}`),
    // so a literal `{` is written `{{` — two literal braces is `{{{{`.
    await userEvent.type(screen.getByRole("textbox"), "{{{{");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("preserves an existing macro node through load and edit", async () => {
    const onChange = vi.fn();
    const content: PageContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "cost.trip", params: {} } }] },
        { type: "paragraph", content: [] },
      ],
    };
    render(<PageEditor detail={detail} context={context} value={content} onChange={onChange} />);

    await userEvent.type(screen.getByRole("textbox"), "hello");

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(JSON.stringify(lastCall)).toContain('"macro"');
    expect(JSON.stringify(lastCall)).toContain("cost.trip");
  });
});
