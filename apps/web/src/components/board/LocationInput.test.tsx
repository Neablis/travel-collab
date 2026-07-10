import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocationInput } from "./LocationInput";

const server = setupServer(
  http.get("/api/geocode", () =>
    HttpResponse.json({ results: [{ lat: 41.89, lng: 12.49, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" }] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("LocationInput", () => {
  it("geocodes on search and emits the picked Location", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/place/i), "Colosseum");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    const pick = await screen.findByText(/Colosseum, Rome/i);
    await userEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ name: "Colosseum, Rome, Italy", lat: 41.89, lng: 12.49, countryCode: "IT" }),
    );
  });
});
