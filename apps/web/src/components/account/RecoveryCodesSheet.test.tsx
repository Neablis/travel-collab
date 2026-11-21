import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryCodesSheet } from "./RecoveryCodesSheet";

const CODES = Array.from({ length: 10 }, (_, i) => `abcd${i}-efgh${i}`);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RecoveryCodesSheet", () => {
  it("shows all ten codes and keeps Done disabled until the person ticks that they saved them", async () => {
    const onDone = vi.fn();
    render(<RecoveryCodesSheet codes={CODES} onDone={onDone} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);

    const done = screen.getByRole("button", { name: "Done" });
    expect(done.hasAttribute("disabled")).toBe(true);
    await userEvent.click(done);
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: "I saved these" }));
    expect(done.hasAttribute("disabled")).toBe(false);
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is not closed by Escape before the codes are saved", async () => {
    const onDone = vi.fn();
    render(<RecoveryCodesSheet codes={CODES} onDone={onDone} />);
    await userEvent.keyboard("{Escape}");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Save your recovery codes" })).toBeTruthy();
  });

  it("copies the codes, one to a line", async () => {
    const writeText = vi.fn(async () => {});
    // `userEvent.setup()` installs its own clipboard, so the stub goes in after it.
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<RecoveryCodesSheet codes={CODES} onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));
    expect((await screen.findByRole("status")).textContent).toBe("Copied.");
  });

  it("downloads them as a text file", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => (created.push(blob), "blob:codes"),
      revokeObjectURL: () => {},
    });
    // jsdom cannot navigate to a blob URL; what matters is what was clicked.
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<RecoveryCodesSheet codes={CODES} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(clicked).toEqual(["caesura-recovery-codes.txt"]);
    expect(created).toHaveLength(1);
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]!);
    });
    for (const code of CODES) expect(text).toContain(code);
  });

  it("offers the revoke tick unticked when asked, and hands its state to onDone", async () => {
    const onDone = vi.fn();
    render(<RecoveryCodesSheet codes={CODES} onDone={onDone} offerRevoke />);
    await userEvent.click(screen.getByRole("checkbox", { name: "I saved these" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenLastCalledWith(false);

    onDone.mockClear();
    cleanup();
    render(<RecoveryCodesSheet codes={CODES} onDone={onDone} offerRevoke />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Also revoke all tokens and connected apps/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "I saved these" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenLastCalledWith(true);
  });

  it("does not show the tick unless asked", () => {
    render(<RecoveryCodesSheet codes={CODES} onDone={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /Also revoke all tokens and connected apps/ })).toBeNull();
  });
});
