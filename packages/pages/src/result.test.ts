import { describe, expect, it } from "vitest";
import { ok, empty, unbound } from "./result";

describe("MacroResult", () => {
  it("ok carries a value", () => {
    const r = ok(42);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value).toBe(42);
  });
  it("empty is valueless", () => { expect(empty().status).toBe("empty"); });
  it("unbound names what it needs", () => {
    const r = unbound("day");
    expect(r).toEqual({ status: "unbound", needs: "day" });
  });
});
