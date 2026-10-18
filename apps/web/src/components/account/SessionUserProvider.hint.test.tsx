import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SIGNED_IN_HINT_COOKIE, clearSignedInHint, hasSignedInHint } from "@/lib/sessionHint";
import { SessionUserProvider, type SessionUser } from "./useSessionUser";

// The `(app)` shell's half of ADR-078's hint: a sign-in that lands on a page
// the proxy does not match (`/plans`, `/playbooks/…`) must still leave the
// browser hinted, or the bare domain shows a signed-in person the landing.
function shell(props: { initialUser?: SessionUser | null; noSessionCookie?: boolean }) {
  return (
    <SessionUserProvider {...props}>
      <span />
    </SessionUserProvider>
  );
}

afterEach(() => {
  cleanup();
  document.cookie = `${SIGNED_IN_HINT_COOKIE}=; Path=/; Max-Age=0`;
});

describe("SessionUserProvider sets the signed-in hint", () => {
  it("sets the hint once the shell knows who is reading", () => {
    render(shell({ initialUser: { id: "user-1", name: "Sam", email: "sam@example.com" } }));
    expect(hasSignedInHint(document.cookie)).toBe(true);
  });

  it("leaves it unset for a reader with no session", () => {
    render(shell({ noSessionCookie: true }));
    expect(hasSignedInHint(document.cookie)).toBe(false);
  });

  it("leaves it unset for a cookie the server found no session behind", () => {
    render(shell({ initialUser: null }));
    expect(hasSignedInHint(document.cookie)).toBe(false);
  });

  // Last in this file on purpose: clearing marks the document as signing out
  // for the rest of its life, as a real sign-out does until its full load.
  it("does not put the hint back once sign-out has cleared it", () => {
    const user = { id: "user-1", name: "Sam", email: "sam@example.com" };
    const view = render(shell({ initialUser: user }));
    clearSignedInHint();
    view.rerender(shell({ initialUser: { ...user } }));
    view.unmount();
    render(shell({ initialUser: user }));
    expect(hasSignedInHint(document.cookie)).toBe(false);
  });
});
