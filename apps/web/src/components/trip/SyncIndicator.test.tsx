import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncIndicator } from "./SyncIndicator";

afterEach(cleanup);

describe("SyncIndicator", () => {
  it("says saving while commands are in flight", () => {
    render(<SyncIndicator pending={2} />);
    expect(screen.getByRole("status").textContent).toMatch(/saving/i);
  });

  it("says all changes saved when the queue is drained", () => {
    render(<SyncIndicator pending={0} />);
    expect(screen.getByRole("status").textContent).toMatch(/all changes saved/i);
  });
});
