import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionUserProvider, useSessionUser } from "./useSessionUser";

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

// ADR-061: under `(app)/layout.tsx` the header, the tab bar and the playbook
// screens all ask, and a provider is what makes that one read rather than one
// per caller.
describe("SessionUserProvider", () => {
  it("reads the session once for every caller beneath it", async () => {
    const sessionRead = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", sessionRead);
    render(
      <SessionUserProvider>
        <Probe />
        <Probe />
        <Probe />
      </SessionUserProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("probe").map((el) => el.textContent)).toEqual(["signed-out", "signed-out", "signed-out"]));
    expect(sessionRead).toHaveBeenCalledTimes(1);
  });

  // The provider's own "not known yet" must not read as "no provider here",
  // or every caller would start a fetch of its own while the first is in flight.
  it("does not let a caller fetch for itself while the provider's read is in flight", async () => {
    let answer: (r: Response) => void = () => {};
    const sessionRead = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", sessionRead);
    render(
      <SessionUserProvider>
        <Probe />
        <Probe />
      </SessionUserProvider>,
    );
    expect(screen.getAllByTestId("probe").map((el) => el.textContent)).toEqual(["unknown", "unknown"]);
    expect(sessionRead).toHaveBeenCalledTimes(1);
    answer(new Response(JSON.stringify({ user: { email: "sam@example.com" } }), { status: 200 }));
    await waitFor(() =>
      expect(screen.getAllByTestId("probe").map((el) => el.textContent)).toEqual(["sam@example.com", "sam@example.com"]),
    );
    expect(sessionRead).toHaveBeenCalledTimes(1);
  });

  // The layout saw no session cookie (`lib/sessionHint.ts`). Nobody is signed
  // in, so the first render already says so — which is what the server paints —
  // and nothing is asked.
  it("starts signed out and asks nothing when there is no session cookie", () => {
    const sessionRead = vi.fn(async () => new Response(JSON.stringify({ user: { email: "x@example.com" } }), { status: 200 }));
    vi.stubGlobal("fetch", sessionRead);
    render(
      <SessionUserProvider noSessionCookie>
        <Probe />
      </SessionUserProvider>,
    );
    expect(read()).toBe("signed-out");
    expect(sessionRead).not.toHaveBeenCalled();
  });
});
