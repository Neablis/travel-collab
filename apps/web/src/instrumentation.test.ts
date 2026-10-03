import { execFileSync } from "node:child_process";
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

// The RSC payload of a prefetch, where every traced occurrence came from, is
// rendered by the Flight server Next bundles, not by react-dom. It refuses to
// load without the `react-server` condition, so it runs in a child process
// with that condition set: the same file and the same cancel path production
// uses, so a Next upgrade that rewords its message turns this file red too.
const FLIGHT_CANCEL = `
const { PassThrough } = require("node:stream");
const path = require("node:path");
const next = path.dirname(require.resolve("next/package.json", { paths: [process.cwd()] }));
const flight = require(path.join(next, "dist/compiled/react-server-dom-webpack/server.node"));
const messages = {};
const cancel = (mode) =>
  new Promise((resolve) => {
    const destination = new PassThrough();
    destination.on("error", () => {});
    const { pipe } = flight.renderToPipeableStream({ later: new Promise(() => {}) }, {}, {
      onError: (err) => resolve((messages[mode] = err.message)),
    });
    pipe(destination);
    setImmediate(() => (mode === "close" ? destination.destroy() : destination.destroy(new Error("EPIPE"))));
  });
Promise.all([cancel("close"), cancel("error")]).then(() => {
  process.stdout.write(JSON.stringify(messages));
  process.exit(0);
});
`;

/** The messages Next's own Flight server gives a client that left (`close`) and a write that failed (`error`). */
function errorsFromNextFlight(): { close: string; error: string } {
  const out = execFileSync(process.execPath, ["--conditions=react-server", "-e", FLIGHT_CANCEL], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(out) as { close: string; error: string };
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

  it("drops a prefetch's RSC payload the client abandoned, as Next's Flight server words it", async () => {
    const { close, error } = errorsFromNextFlight();
    expect(close).toBe("The destination stream closed early.");
    expect(error).toBe("The destination stream errored while writing data.");

    await onRequestError(new Error(close), request, context);
    expect(Sentry.captureRequestError).not.toHaveBeenCalled();

    // Flight's other cancel is still reported, as Fizz's is.
    const failedWrite = new Error(error);
    await onRequestError(failedWrite, request, context);
    expect(Sentry.captureRequestError).toHaveBeenCalledWith(failedWrite, request, context);
  });

  it("still reports a genuine render error", async () => {
    const thrown = new Error("Cannot read properties of undefined (reading 'stops')");

    await onRequestError(thrown, request, context);

    expect(Sentry.captureRequestError).toHaveBeenCalledWith(thrown, request, context);
  });
});
