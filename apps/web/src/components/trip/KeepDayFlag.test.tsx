import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepDayFlag } from "./KeepDayFlag";

afterEach(cleanup);

describe("KeepDayFlag", () => {
  it("renders an accessible icon-only button labeled with the 1-based day number", () => {
    render(<KeepDayFlag dayIndex={2} accent="brand" />);
    expect(screen.getByRole("button", { name: "Keep day 3" })).not.toBeNull();
  });
});
