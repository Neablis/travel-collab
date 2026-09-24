import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExternalNeed } from "@tc/pages";
import { clearQueryCache } from "@/lib/queryCache";
import { useExternalInputs } from "./useExternalInputs";

const TRIP = "11111111-1111-1111-1111-111111111111";
const WEATHER = new Set<ExternalNeed>(["weather"]);
const NOTHING = new Set<ExternalNeed>();

let weatherCalls = 0;
const server = setupServer(
  http.get("/api/trips/:tripId/weather", () => {
    weatherCalls += 1;
    return HttpResponse.json({ weather: { points: [] } });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  clearQueryCache();
  weatherCalls = 0;
});
afterAll(() => server.close());

describe("useExternalInputs (ADR-052)", () => {
  it("never asks for weather when no widget on the page needs it", async () => {
    const { result } = renderHook(() => useExternalInputs(TRIP, NOTHING));
    // A tick for any stray effect to have fired its request.
    await new Promise((r) => setTimeout(r, 20));
    expect(weatherCalls).toBe(0);
    expect(result.current.weather).toEqual({ state: "pending" });
  });

  it("marks the slot failed when the route answers 404 — as it does until T24 builds it", async () => {
    server.use(http.get("/api/trips/:tripId/weather", () => HttpResponse.json({ error: "not-found" }, { status: 404 })));
    const { result } = renderHook(() => useExternalInputs(TRIP, WEATHER));
    expect(result.current.weather).toEqual({ state: "pending" });
    await waitFor(() => expect(result.current.weather).toEqual({ state: "failed" }));
  });

  it("marks the slot failed when the body does not match the contract", async () => {
    server.use(http.get("/api/trips/:tripId/weather", () => HttpResponse.json({ weather: { points: "nope" } })));
    const { result } = renderHook(() => useExternalInputs(TRIP, WEATHER));
    await waitFor(() => expect(result.current.weather).toEqual({ state: "failed" }));
  });

  it("hands the parsed weather over once it lands", async () => {
    const { result } = renderHook(() => useExternalInputs(TRIP, WEATHER));
    await waitFor(() => expect(result.current.weather).toEqual({ state: "ready", value: { points: [] } }));
    expect(weatherCalls).toBe(1);
  });

  it("asks once a weather widget arrives on a page that had none", async () => {
    const { result, rerender } = renderHook(({ needs }) => useExternalInputs(TRIP, needs), {
      initialProps: { needs: NOTHING },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(weatherCalls).toBe(0);
    rerender({ needs: WEATHER });
    await waitFor(() => expect(result.current.weather.state).toBe("ready"));
    expect(weatherCalls).toBe(1);
  });
});
