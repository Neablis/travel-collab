// M45 decision 3: the layout sends the reader's plan with the page. A read
// that fails falls back to `null` so the app stays up, but it must still be
// reported: a version reference that no longer resolves has to fail loudly
// (ADR-045 rule 3), and the fallback alone would hide it.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "authjs.session-token", value: "x" }] }),
}));
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: "user-a" } }) }));
const fault = vi.hoisted(() => new Error("plan version v9 does not resolve"));
vi.mock("@/server/entitlements/resolver", () => ({
  entitlementsFor: async () => {
    throw fault;
  },
}));
const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

import AppLayout from "./layout";

describe("the app layout's plan read", () => {
  it("reports a failed read and serves no plan", async () => {
    // The layout's root is `SessionUserProvider`, and its child the provider
    // the plan goes down through.
    const tree = (await AppLayout({ children: null })) as React.ReactElement<{
      children: React.ReactElement<{ entitlements: unknown }>;
    }>;
    expect(captureException).toHaveBeenCalledWith(fault);
    // `null`, not `[]`: an empty list is a served answer, and would withhold
    // the Ask from every paying reader whenever the read fails.
    expect(tree.props.children.props.entitlements).toBeNull();
  });
});
