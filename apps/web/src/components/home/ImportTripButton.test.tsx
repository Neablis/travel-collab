import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import { createRef } from "react";
import { ImportTripButton, type ImportTripHandle } from "./ImportTripButton";

const LABEL = "Import a trip file";

const fetchMock = vi.fn();

afterEach(cleanup);
beforeEach(() => {
  pushMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

// **Pretty-printed on purpose, and the indentation is the assertion.** A
// bundle built with `JSON.stringify` survives `JSON.parse` + `JSON.stringify`
// byte for byte, so a test using one cannot tell "the file's own bytes" from a
// re-serialisation of them — which is the exact claim the first test makes.
// Written first with a compact fixture, and caught by breaking the code it
// protects and watching the test pass anyway (CLAUDE.md rule 3).
const BUNDLE = JSON.stringify(
  {
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id: "kyoto", name: "Kyoto", origin: "human" },
    trips: [{ key: "kyoto", name: "Kyoto", days: [{ stops: [{ title: "A stop" }] }] }],
  },
  null,
  2,
);

const file = (text = BUNDLE) => new File([text], "kyoto.json", { type: "application/json" });

/** The picker has no accessible identity on purpose — rung 3 of the ladder. */
const picker = () => screen.getByTestId("trip-file-input") as HTMLInputElement;

async function choose(contents?: string) {
  const user = userEvent.setup();
  await user.upload(picker(), file(contents));
}

function ok(body: unknown) {
  return { ok: true, status: 201, json: async () => body };
}
function refused(status: number, message: string) {
  return { ok: false, status, json: async () => ({ error: { code: "invalid-request", message } }) };
}

describe("ImportTripButton", () => {
  // **The same `v1` endpoint an API caller uses**, reached with the session
  // cookie the browser already has. No token, no `apiClient`, no MSW handler.
  it("posts the file's own bytes to the v1 import endpoint and opens the trip", async () => {
    fetchMock.mockResolvedValue(ok({ tripId: "11111111-1111-4111-8111-111111111111" }));
    render(<ImportTripButton label={LABEL} />);
    await choose();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/trips/import");
    expect(init.method).toBe("POST");
    // **The file's bytes, not a re-serialisation of them** — so the size the
    // server measures is the size the person chose, and the limit it names in
    // a refusal is one they can act on.
    expect(init.body).toBe(BUNDLE);

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/trips/11111111-1111-4111-8111-111111111111"),
    );
  });

  // **The server's own words.** Its refusals are already written for a person
  // to act on, and restating them here would be a second copy that drifts.
  it("shows the server's refusal rather than a message of its own", async () => {
    fetchMock.mockResolvedValue(
      refused(400, "That trip has 1,001 stops. The limit is 1,000."),
    );
    render(<ImportTripButton label={LABEL} />);
    await choose();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That trip has 1,001 stops. The limit is 1,000.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  // A response that never reached the route — a proxy, a signed-out redirect —
  // has no envelope to read, and silence is the one answer that cannot be acted
  // on.
  it("says something when the response carries no envelope at all", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    render(<ImportTripButton label={LABEL} />);
    await choose();

    // **Still `role="alert"` now that this renders through `Banner`** (§34.2,
    // M26 link 9c). `Banner`'s own default is `role="status"`, and a refusal
    // that lands after the reader has chosen a file and looked away from the
    // button is worth interrupting for — so the override is behaviour, not
    // decoration, and this assertion is what holds it. The LOOK of the banner
    // is not asserted here: class assertions live in `components/ui/**` by the
    // lint wall's rule, and the colour wall owns the rest.
    expect((await screen.findByRole("alert")).textContent).toContain("could not be imported");
  });

  // **The picker is cleared after every choice**, so that choosing the SAME
  // file again still fires `change`. Without it a failed import cannot be
  // retried without picking a different file, and the button looks dead.
  //
  // Asserted as the input's `value` rather than by uploading twice, because
  // jsdom's `user.upload` re-fires `change` for an identical file where a real
  // browser does not — so the behavioural version of this test passes whether
  // or not the code clears anything. Found by deleting the line and watching
  // that version stay green (CLAUDE.md rule 3). The value is the mechanism, and
  // it is the most this layer can honestly say; the two-uploads-in-a-row
  // version of the claim belongs to the e2e lane, in a real browser.
  it("clears the picker after a choice, so the same file can be retried", async () => {
    fetchMock.mockResolvedValue(refused(400, "This file contains no trip to import."));
    render(<ImportTripButton label={LABEL} />);

    await choose();
    await screen.findByRole("alert");
    expect(picker().value).toBe("");
    expect(picker().files?.length ?? 0).toBe(0);
  });

  it("is disabled while the page is busy with something else", () => {
    render(<ImportTripButton label={LABEL} disabled />);
    expect(screen.getByRole("button", { name: LABEL }).hasAttribute("disabled")).toBe(true);
  });

  // **The new-trip sheet's link has no picker of its own** (SPEC §35.2): it
  // closes the sheet, which unmounts it, so it opens THIS one through the
  // handle — synchronously, inside its own click, or the browser drops the
  // gesture and no picker appears. What is asserted is the mechanism the
  // browser needs: a click on the hidden input.
  it("opens its picker for a caller that holds the handle", () => {
    const handle = createRef<ImportTripHandle>();
    render(<ImportTripButton label={LABEL} handle={handle} />);
    const clicked = vi.fn();
    picker().addEventListener("click", clicked);

    handle.current!.pick();

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  // And not while the page is holding every trip-start (a demo clone landing):
  // a handle that ignored `disabled` would be a way round the button's own
  // guard.
  it("does not open its picker through the handle while disabled", () => {
    const handle = createRef<ImportTripHandle>();
    render(<ImportTripButton label={LABEL} handle={handle} disabled />);
    const clicked = vi.fn();
    picker().addEventListener("click", clicked);

    handle.current!.pick();

    expect(clicked).not.toHaveBeenCalled();
  });
});
