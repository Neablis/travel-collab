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
  });

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
