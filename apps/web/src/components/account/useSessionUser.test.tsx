import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionUser } from "./useSessionUser";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The three states spelled as three strings, because the whole point of this
// hook is that "not yet / failed" and "nobody signed in" are DIFFERENT and the
// old code collapsed them. A boolean probe could not tell them apart either.
function Probe() {
  const user = useSessionUser();
  return (
    <div data-testid="probe">
      {user === undefined ? "unknown" : user === null ? "signed-out" : (user.email ?? "no-email")}
    </div>
  );
}

const read = () => screen.getByTestId("probe").textContent;

describe("useSessionUser", () => {
  it("reports the signed-in address once the read lands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ user: { email: "sam@example.com" } }), { status: 200 })),
    );
    render(<Probe />);
    await waitFor(() => expect(read()).toBe("sam@example.com"));
  });

  it("reports signed out for a 200 that carries no user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    render(<Probe />);
    await waitFor(() => expect(read()).toBe("signed-out"));
  });

  // **The defect this file was written for.** next-auth's `getSession()` catches
  // a failed fetch and returns `null` — the same value as a confirmed empty
  // session — so `AccountScreen` passed `""` to `ProfileSection` and an account
  // WITH an address was told "Not provided by your sign-in".
  it("stays unknown when the session request fails, rather than claiming signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<Probe />);
    // Give the effect every chance to settle on the wrong answer.
    await new Promise((r) => setTimeout(r, 0));
    expect(read()).toBe("unknown");
  });

  it("stays unknown when the session request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 0));
    expect(read()).toBe("unknown");
  });
});
