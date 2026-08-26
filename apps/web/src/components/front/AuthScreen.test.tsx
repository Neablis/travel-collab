import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));

import { AuthScreen } from "./AuthScreen";

afterEach(() => {
  cleanup();
  signInMock.mockReset();
  searchParams = new URLSearchParams();
});

describe("AuthScreen", () => {
  it("greets a returning user in signin mode", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByText(/Google is the only way in/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
  });

  it("pitches the product in signup mode", () => {
    render(<AuthScreen mode="signup" devLoginEnabled={false} />);
    expect(screen.getByRole("heading", { name: "Start planning with Caesura" })).toBeDefined();
    expect(screen.getByText(/name, email and profile picture/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("dispatches a real Google sign-in", async () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  // I3 (final review): before this branch, Auth.js's own default sign-in
  // page honoured `?callbackUrl=`, so a signed-out deep link to a trip
  // landed back on that trip after signing in. `server/auth.ts` now points
  // at this screen, which used to hardcode `callbackUrl: "/"` regardless of
  // the query param — a real regression this branch introduced. This test
  // is the return-to-destination behavior's coverage.
  it("carries a same-origin callbackUrl through to the Google sign-in", async () => {
    searchParams = new URLSearchParams("callbackUrl=/trips/abc-123");
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/trips/abc-123" });
  });

  it("carries a same-origin callbackUrl through to the dev-login sign-in", async () => {
    searchParams = new URLSearchParams("callbackUrl=/trips/abc-123");
    render(<AuthScreen mode="signin" devLoginEnabled />);
    await userEvent.type(screen.getByLabelText("Username"), "sam");
    await userEvent.click(screen.getByRole("button", { name: /sign in with dev login/i }));
    expect(signInMock).toHaveBeenCalledWith("dev-login", { username: "sam", callbackUrl: "/trips/abc-123" });
  });

  // Security constraint: `callbackUrl` is untrusted input taken straight off
  // the URL and handed to next-auth's signIn(), which redirects the browser
  // there. A protocol-relative URL ("//evil.example") "starts with /" but
  // the browser resolves it against the current protocol, so it is an
  // open-redirect vector unless explicitly rejected — this is that
  // rejection's regression guard, exercised through the real component, not
  // just the safeCallbackUrl unit tests.
  it("rejects a protocol-relative callbackUrl and falls back to / (open-redirect guard)", async () => {
    searchParams = new URLSearchParams("callbackUrl=//evil.example");
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  it("rejects an absolute cross-origin callbackUrl and falls back to /", async () => {
    searchParams = new URLSearchParams("callbackUrl=https://evil.example/phish");
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  it("explains a declined Google grant instead of showing a code", () => {
    searchParams = new URLSearchParams("error=AccessDenied");
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    expect(screen.getByText(/didn't hand us an account/)).toBeDefined();
    expect(screen.queryByText("AccessDenied")).toBeNull();
  });

  it("falls back to plain language for an unrecognised error code", () => {
    searchParams = new URLSearchParams("error=SomethingNewFromAuthJs");
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    expect(screen.getByText(/Something went wrong signing you in/)).toBeDefined();
    expect(screen.queryByText("SomethingNewFromAuthJs")).toBeNull();
  });

  // I2 (final review): `ERROR_MESSAGES[code] ?? FALLBACK` on a plain object
  // literal inherits from `Object.prototype`, so a `?error=` value matching
  // an inherited member (`__proto__`, `toString`, `constructor`, ...)
  // resolved to that inherited object/function instead of the fallback
  // string — `errorMessage`'s `string | null` contract was a lie for these
  // inputs. React would then either throw rendering an object child
  // (`__proto__`) or silently drop a function child (`toString`), producing
  // exactly the blank/broken error state this milestone's gate claims can't
  // happen. These adversarial codes are the regression guard for that fix.
  it.each(["__proto__", "toString", "constructor", "hasOwnProperty"])(
    "falls back to plain language for the adversarial error code %j, never rendering the raw code",
    (code) => {
      searchParams = new URLSearchParams({ error: code });
      render(<AuthScreen mode="signin" devLoginEnabled={false} />);
      expect(screen.getByText(/Something went wrong signing you in/)).toBeDefined();
      expect(screen.queryByText(code)).toBeNull();
    },
  );

  it("hides the dev-login form unless it is enabled", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} />);
    expect(screen.queryByRole("button", { name: /sign in with dev login/i })).toBeNull();
  });

  it("keeps the dev-login selectors e2e/helpers.ts depends on", () => {
    const { container } = render(<AuthScreen mode="signin" devLoginEnabled />);
    expect(container.querySelector('input[name="username"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /sign in with dev login/i })).toBeDefined();
  });
});
