import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));

import { ADMISSION_FIELD_COPY } from "./authCopy";
import { AuthScreen } from "./AuthScreen";

// Stands in for the Server Action signup/page.tsx passes down. Async on
// purpose: the ordering this whole mechanism exists for (cookie written
// before the browser leaves for Google) only means anything if the write is
// a real round trip the component waits for.
const storeAdmissionCodeMock = vi.fn(async (_code: string) => {});

afterEach(() => {
  cleanup();
  signInMock.mockReset();
  storeAdmissionCodeMock.mockClear();
  searchParams = new URLSearchParams();
});

describe("AuthScreen", () => {
  it("greets a returning user in signin mode", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeDefined();
    expect(screen.getByText(/Google is the only way in/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe("/signup");
  });

  it("pitches the product in signup mode", () => {
    render(<AuthScreen mode="signup" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByRole("heading", { name: "Start planning with Caesura" })).toBeDefined();
    expect(screen.getByText(/name, email and profile picture/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/signin");
  });

  it("dispatches a real Google sign-in", async () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
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
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/trips/abc-123" });
  });

  // One of the three places the "Make this trip mine" intent was being dropped
  // (Mitchell, 2026-09-01): you press it on `/demo`, land on
  // `/signin?callbackUrl=/demo`, follow "Create an account" because you
  // have none — and arrive at a bare `/signup` that has forgotten where you
  // were going. Someone with no account is exactly who that CTA sends here, so
  // this hop is the common path.
  it("carries the callbackUrl across the sign-in / sign-up swap", async () => {
    searchParams = new URLSearchParams("callbackUrl=/trips/abc-123?lens=Map");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
        `/signup?callbackUrl=${encodeURIComponent("/trips/abc-123?lens=Map")}`,
      ),
    );
  });

  // CodeRabbit (PR #104): `next/link` renders a real anchor in the
  // server-rendered HTML, and `AuthSearchParams`' effect only resolves the
  // real callbackUrl post-render — so before this fix a click that beat the
  // effect landed on a bare `/signup`. `initialCallbackUrl` is what
  // `signin/page.tsx` / `signup/page.tsx` compute server-side from the same
  // `?callbackUrl=` and pass down, so it should already be correct on the
  // very FIRST render, with no wait for anything to resolve — unlike the
  // three tests around this one (which rely on `AuthSearchParams`' effect
  // and so all `await waitFor`), this assertion is synchronous on purpose:
  // if the fix regressed to reading the value only from the effect, this
  // is the test that would start needing a `waitFor` to pass, and that
  // regression is exactly what this test exists to catch.
  it("renders the swap link correctly on the very first render, from initialCallbackUrl", () => {
    searchParams = new URLSearchParams("callbackUrl=/trips/abc-123?lens=Map");
    render(
      <AuthScreen
        mode="signin"
        devLoginEnabled={false}
        googleAvailable
        initialCallbackUrl="/trips/abc-123?lens=Map"
      />,
    );
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
      `/signup?callbackUrl=${encodeURIComponent("/trips/abc-123?lens=Map")}`,
    );
  });

  it("leaves the swap link plain when there is nowhere in particular to go back to", async () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
        "/signup",
      ),
    );
  });

  // A hostile `?callbackUrl=` is normalised to "/" before anything reads it
  // (`safeCallbackUrl`), and the swap link is built from the NORMALISED value —
  // so an open-redirect attempt cannot ride across the hop either.
  it("does not carry a hostile callbackUrl across the swap", async () => {
    searchParams = new URLSearchParams("callbackUrl=//evil.example/steal");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
        "/signup",
      ),
    );
  });

  // "Pressing enter in many fields doesnt submit — Signin (input from code)"
  // (Mitchell, 2026-09-01). The invite code is the only field on the screen and
  // the button under it is the only thing to do with what you typed, so Enter
  // has to mean that button — including the code reaching the cookie writer
  // first, which is the whole ordering this mechanism exists for.
  it("continues with Google when Enter is pressed in the invite-code field", async () => {
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled={false}
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "LET-ME-IN{Enter}");
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" }));
    expect(storeAdmissionCodeMock).toHaveBeenCalledWith("LET-ME-IN");
  });

  it("does not sign in on Enter when Google is not configured", async () => {
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled={false}
        googleAvailable={false}
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "LET-ME-IN{Enter}");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("carries a same-origin callbackUrl through to the dev-login sign-in", async () => {
    searchParams = new URLSearchParams("callbackUrl=/trips/abc-123");
    render(<AuthScreen mode="signin" devLoginEnabled googleAvailable />);
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
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  it("rejects an absolute cross-origin callbackUrl and falls back to /", async () => {
    searchParams = new URLSearchParams("callbackUrl=https://evil.example/phish");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });

  it("explains a declined Google grant instead of showing a code", () => {
    searchParams = new URLSearchParams("error=AccessDenied");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/didn't hand us an account/)).toBeDefined();
    expect(screen.queryByText("AccessDenied")).toBeNull();
  });

  it("falls back to plain language for an unrecognised error code", () => {
    searchParams = new URLSearchParams("error=SomethingNewFromAuthJs");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
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
      render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
      expect(screen.getByText(/Something went wrong signing you in/)).toBeDefined();
      expect(screen.queryByText(code)).toBeNull();
    },
  );

  // M11a link 6. Three refusals, three next actions — a shared message would
  // be a dead end for two of the three people who see it, so each is asserted
  // on a phrase only it contains, and on NOT being the generic fallback.
  it("tells someone with no invite at all where to get one", () => {
    searchParams = new URLSearchParams("error=MISSING_INVITE_CODE");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/Caesura is invite-only while it is small/)).toBeDefined();
    expect(screen.queryByText(/Something went wrong signing you in/)).toBeNull();
    expect(screen.queryByText("MISSING_INVITE_CODE")).toBeNull();
  });

  it("tells someone with an unrecognised code to check it and who to ask", () => {
    searchParams = new URLSearchParams("error=INVALID_INVITE_CODE");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/not one of ours/)).toBeDefined();
    expect(screen.queryByText(/Something went wrong signing you in/)).toBeNull();
    expect(screen.queryByText("INVALID_INVITE_CODE")).toBeNull();
  });

  it("tells someone whose code was already redeemed that each one works once", () => {
    searchParams = new URLSearchParams("error=SPENT_INVITE_CODE");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/has already been used, and each one works only once/)).toBeDefined();
    expect(screen.queryByText(/Something went wrong signing you in/)).toBeNull();
    expect(screen.queryByText("SPENT_INVITE_CODE")).toBeNull();
  });

  // The refusals are a closed set (`AdmissionRefusal` in @tc/contracts) and
  // `errorMessage` parses the param against it rather than indexing a map, so
  // nothing that merely *looks* like one of ours gets our copy: wrong case, a
  // trailing space, a regex alternation, a near-miss name. Each has to land on
  // the generic fallback without throwing.
  it.each([
    "NOT_A_REAL_CODE",
    "missing_invite_code",
    "MISSING_INVITE_CODE ",
    "MISSING_INVITE_CODE|SPENT_INVITE_CODE",
    "INVITE_CODE",
    ".*",
  ])("refuses the near-miss admission code %j and shows the fallback instead", (code) => {
    searchParams = new URLSearchParams({ error: code });
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/Something went wrong signing you in/)).toBeDefined();
    expect(screen.queryByText(/Caesura is invite-only while it is small/)).toBeNull();
  });

  // Adding the admission map must not have cost the Auth.js codes their
  // handling — they arrive on the same `?error=` param and are checked second.
  it("still resolves Auth.js's own error codes after the admission parse", () => {
    searchParams = new URLSearchParams("error=OAuthAccountNotLinked");
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/already here under a different sign-in method/)).toBeDefined();
  });

  // The invite-code field is signup-only. On `/signin` the visitor either has
  // a `users` row already (the gate waves them through) or arrived on a trip
  // invite link `proxy.ts` has already banked — neither has a code to type,
  // and a field asking for one would read as a requirement that isn't one.
  it("asks for an invite code in signup mode", () => {
    render(<AuthScreen mode="signup" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByLabelText("Invite code")).toBeDefined();
  });

  it("does not ask for an invite code in signin mode", () => {
    render(<AuthScreen mode="signin" devLoginEnabled googleAvailable />);
    expect(screen.queryByLabelText("Invite code")).toBeNull();
  });

  // A labelled box with no explanation is the defect this closes: a first-time
  // visitor could not tell whether the code was required or where to get one.
  // Asserted through ADMISSION_FIELD_COPY rather than as literals, so revising
  // the wording (it is awaiting design sign-off) does not fail the test for
  // the wrong reason — what is pinned is that both strings reach the screen.
  it("says why the invite code is being asked for, and when it may be left empty", () => {
    render(<AuthScreen mode="signup" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(ADMISSION_FIELD_COPY.note)).toBeDefined();
    expect(screen.getByText(ADMISSION_FIELD_COPY.hint)).toBeDefined();
  });

  it("carries neither line in signin mode, where there is no field to explain", () => {
    render(<AuthScreen mode="signin" devLoginEnabled googleAvailable />);
    expect(screen.queryByText(ADMISSION_FIELD_COPY.note)).toBeNull();
    expect(screen.queryByText(ADMISSION_FIELD_COPY.hint)).toBeNull();
  });

  // The ordering assertion this whole mechanism exists for. The code has to be
  // in the httpOnly `pending_admission` cookie BEFORE the browser leaves for
  // Google, because the OAuth callback comes back with no memory of the form.
  // `invocationCallOrder` is what pins "before" — asserting both were called
  // would pass on the broken ordering too.
  it("writes the invite code server-side before it leaves for Google", async () => {
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled={false}
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "SPRING-2026");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" }));
    expect(storeAdmissionCodeMock).toHaveBeenCalledWith("SPRING-2026");
    expect(storeAdmissionCodeMock.mock.invocationCallOrder[0]).toBeLessThan(
      signInMock.mock.invocationCallOrder[0]!,
    );
  });

  it("trims a pasted code before storing it", async () => {
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled={false}
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "  SPRING-2026  ");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInMock).toHaveBeenCalled());
    expect(storeAdmissionCodeMock).toHaveBeenCalledWith("SPRING-2026");
  });

  // An empty submit must write NOTHING, not an empty cookie: `proxy.ts` stores
  // a pending trip-invite token under the same name, so someone who opened
  // `/invite/<token>` and then walked to `/signup` would have their admission
  // erased by a blank write. Sign-in still has to proceed — the code is
  // optional here and the gate decides, not this screen.
  it.each(["", "   "])(
    "writes nothing for the blank code %j, so a stored invite token survives",
    async (code) => {
      render(
        <AuthScreen
          mode="signup"
          devLoginEnabled={false}
          googleAvailable
          storeAdmissionCode={storeAdmissionCodeMock}
        />,
      );
      if (code) await userEvent.type(screen.getByLabelText("Invite code"), code);
      await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
      await waitFor(() => expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" }));
      expect(storeAdmissionCodeMock).not.toHaveBeenCalled();
    },
  );

  // Build-plan decision 3: dev login goes THROUGH admission rather than
  // carrying an exemption, so it needs the same cookie written first. This is
  // also the only admission path the e2e lane can walk for real (KI-50 blocks
  // a Google round trip from an unregistered preview host).
  it("writes the invite code before a dev-login sign-in too", async () => {
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "SPRING-2026");
    await userEvent.type(screen.getByLabelText("Username"), "sam");
    await userEvent.click(screen.getByRole("button", { name: /sign in with dev login/i }));
    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith("dev-login", { username: "sam", callbackUrl: "/" }),
    );
    expect(storeAdmissionCodeMock.mock.invocationCallOrder[0]).toBeLessThan(
      signInMock.mock.invocationCallOrder[0]!,
    );
  });

  // A Server Action is a network round trip and can fail. The comment in
  // `startSignIn` claims a failed write still signs in, landing the person on
  // the designed refusal screen rather than on a button that does nothing —
  // this is what keeps that claim from being a lie with a timer on it.
  it("still signs in when the cookie write fails, rather than deadening the button", async () => {
    storeAdmissionCodeMock.mockRejectedValueOnce(new Error("network"));
    render(
      <AuthScreen
        mode="signup"
        devLoginEnabled={false}
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.type(screen.getByLabelText("Invite code"), "SPRING-2026");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" }));
  });

  // `/signin` never renders the field, so it must never call the action even
  // if a caller passes one — otherwise the mode gate is cosmetic.
  it("never stores a code from signin mode", async () => {
    render(
      <AuthScreen
        mode="signin"
        devLoginEnabled={false}
        googleAvailable
        storeAdmissionCode={storeAdmissionCodeMock}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(signInMock).toHaveBeenCalled());
    expect(storeAdmissionCodeMock).not.toHaveBeenCalled();
  });

  it("hides the dev-login form unless it is enabled", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.queryByRole("button", { name: /sign in with dev login/i })).toBeNull();
  });

  // `auth.setup.ts` runs before every e2e project and authenticates through
  // exactly these two selectors, so breaking either fails the whole lane at
  // setup rather than in one spec. Both modes, because the invite-code field
  // added a second input to the signup card and `input[name="username"]` has
  // to stay unambiguous.
  it.each(["signin", "signup"] as const)(
    "keeps the dev-login selectors e2e/helpers.ts depends on, in %s mode",
    (mode) => {
      const { container } = render(<AuthScreen mode={mode} devLoginEnabled googleAvailable />);
      expect(container.querySelectorAll('input[name="username"]')).toHaveLength(1);
      expect(screen.getByRole("button", { name: /sign in with dev login/i })).toBeDefined();
      expect(screen.getByLabelText("Username")).toBeDefined();
    },
  );

  // KI: `signIn("google", ...)` for an unregistered provider bounces the
  // browser through /api/auth/providers -> /api/auth/signin and back with no
  // `?error=` at all — that round trip happens entirely client-side, inside
  // next-auth/react, before Auth.js's own error redirect can ever fire. So
  // this state has to be caught server-side (the `googleAvailable` prop) and
  // the button must never be able to trigger that bounce.
  it("explains an unconfigured Google deployment and disables the button instead of bouncing", async () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable={false} />);
    expect(screen.getByText(/Sign-in isn't set up on this deployment/)).toBeDefined();
    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button.hasAttribute("disabled")).toBe(true);
    await userEvent.click(button);
    expect(signInMock).not.toHaveBeenCalled();
  });

  // Correction to the banner added above: `copy.scopeLine` ("Google is the
  // only way in...") sits directly under that banner and would otherwise
  // assert something false in this state — there IS no password to lose
  // because there's no working sign-in at all, not because Google is safe.
  it("hides the scope line when Google is unavailable, since it promises a Google-only sign-in", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable={false} />);
    expect(screen.queryByText(/Google is the only way in/)).toBeNull();
  });

  it("shows the scope line when Google is available", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.getByText(/Google is the only way in/)).toBeDefined();
  });

  // signin's footnote promises an invite-matched account is "waiting" at the
  // address the invite went to — a guarantee only Google's email-verified
  // OAuth can keep, not the dev-login form's arbitrary username. It goes
  // false in the same state the scope line does.
  it("hides the invite-address footnote in signin mode when Google is unavailable", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable={false} />);
    expect(screen.queryByText(/Invited to someone's trip/)).toBeNull();
  });

  // signup's footnote is generic terms/privacy copy that doesn't presume
  // Google works, so it stays even when Google is unavailable.
  it("keeps the generic terms footnote in signup mode even when Google is unavailable", () => {
    render(<AuthScreen mode="signup" devLoginEnabled={false} googleAvailable={false} />);
    expect(screen.getByText(/By continuing you agree to the terms/)).toBeDefined();
  });

  it("still runs the dev-login form when Google is unavailable but dev login is enabled", async () => {
    const { container } = render(<AuthScreen mode="signin" devLoginEnabled googleAvailable={false} />);
    expect(screen.getByText(/Sign-in isn't set up on this deployment/)).toBeDefined();
    expect(container.querySelector('input[name="username"]')).not.toBeNull();
    await userEvent.type(screen.getByLabelText("Username"), "sam");
    await userEvent.click(screen.getByRole("button", { name: /sign in with dev login/i }));
    expect(signInMock).toHaveBeenCalledWith("dev-login", { username: "sam", callbackUrl: "/" });
  });

  it("still explains itself with no dead form when Google and dev login are both unavailable", () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable={false} />);
    expect(screen.getByText(/Sign-in isn't set up on this deployment/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /sign in with dev login/i })).toBeNull();
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Google" }).hasAttribute("disabled")).toBe(true);
  });

  it("leaves Google sign-in unchanged when it is available", async () => {
    render(<AuthScreen mode="signin" devLoginEnabled={false} googleAvailable />);
    expect(screen.queryByText(/Sign-in isn't set up on this deployment/)).toBeNull();
    const button = screen.getByRole("button", { name: "Continue with Google" });
    expect(button.hasAttribute("disabled")).toBe(false);
    await userEvent.click(button);
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/" });
  });
});
