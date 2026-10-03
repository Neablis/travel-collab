import { PassThrough } from "node:stream";
import { createElement, Suspense, use } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { onRequestError } from "./instrumentation";

vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }));

const request = { path: "/playbooks/profile/dev-alice?_rsc=x", method: "GET", headers: { rsc: "1" } };
const context = {
  routerKind: "App Router",
  routePath: "/playbooks/profile/[userId]",
  routeType: "render",
  renderSource: "react-server-components-payload",
  revalidateReason: undefined,
} as const;

/**
 * The error React itself hands `onError` when the stream it is piping into
 * goes away mid-render — produced by React, not written out here, so a React
 * upgrade that rewords it fails this file instead of reopening KI-2026-10-03-a.
 * `close` is the client disconnecting; `error` is a write failing.
 */
function errorFromReact(end: (destination: PassThrough) => void): Promise<unknown> {
  const never = new Promise<never>(() => {});
  function Pending() {
    use(never);
    return null;
  }
  return new Promise((resolve) => {
    const destination = new PassThrough();
    destination.on("error", () => {});
    const { pipe } = renderToPipeableStream(
      createElement(Suspense, { fallback: "loading" }, createElement(Pending)),
      {
        onError: (err) => resolve(err),
        onShellReady() {
          pipe(destination);
          end(destination);
        },
      },
    );
  });
}

describe("onRequestError (KI-2026-10-03-a)", () => {
  beforeEach(() => vi.mocked(Sentry.captureRequestError).mockClear());

  it("drops a render the client abandoned mid-stream", async () => {
    const abandoned = await errorFromReact((d) => d.destroy());
    expect(abandoned).toMatchObject({ message: "The destination stream closed early." });

    await onRequestError(abandoned, request, context);

    expect(Sentry.captureRequestError).not.toHaveBeenCalled();
  });

  it("still reports React's other cancel, a destination that errored", async () => {
    const failedWrite = await errorFromReact((d) => d.destroy(new Error("EPIPE")));
    expect(failedWrite).toMatchObject({ message: "The destination stream errored while writing data." });

    await onRequestError(failedWrite, request, context);

    expect(Sentry.captureRequestError).toHaveBeenCalledWith(failedWrite, request, context);
  });

  it("still reports a genuine render error", async () => {
    const thrown = new Error("Cannot read properties of undefined (reading 'stops')");

    await onRequestError(thrown, request, context);

    expect(Sentry.captureRequestError).toHaveBeenCalledWith(thrown, request, context);
  });
});
