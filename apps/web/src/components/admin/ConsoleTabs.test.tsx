import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ConsoleTabs } from "./ConsoleTabs";

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("the console's tab strip", () => {
  // The strip is rendered from wherever the operator is, an open account page
  // included; the push is the whole of what drops `account` (M36 D1).
  it("navigates to the chosen tab alone", async () => {
    render(<ConsoleTabs value="users" />);
    expect(screen.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "Library" }));
    expect(push).toHaveBeenCalledWith("/admin?tab=library");
  });
});
