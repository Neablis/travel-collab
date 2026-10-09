import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";

const register = vi.fn(() => Promise.resolve());

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  register.mockClear();
});

// The component's doc says production only: installing is what the worker is
// for, and the dev lane has no use for it.
describe("ServiceWorkerRegistration", () => {
  it("registers /sw.js in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { register } });
    render(<ServiceWorkerRegistration />);
    expect(register).toHaveBeenCalledWith("/sw.js", expect.objectContaining({ scope: "/" }));
  });

  it("registers nothing under next dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("navigator", { ...navigator, serviceWorker: { register } });
    render(<ServiceWorkerRegistration />);
    expect(register).not.toHaveBeenCalled();
  });
});
