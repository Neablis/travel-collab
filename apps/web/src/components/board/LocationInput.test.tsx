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
    const pick = await screen.findByRole("option", { name: /Colosseum, Rome/i });
    await userEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ name: "Colosseum, Rome, Italy", lat: 41.89, lng: 12.49, countryCode: "IT" }),
    );
  });

  it("passes the geocoder's structured city through to the picked Location", async () => {
    server.use(
      http.get("/api/geocode", () =>
        HttpResponse.json({
          results: [{ lat: 43.1566, lng: -77.6088, canonicalName: "The Strong, Rochester, NY, USA", countryCode: "US", city: "Rochester" }],
        }),
      ),
    );
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/place/i), "Strong Museum");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    const pick = await screen.findByRole("option", { name: /The Strong, Rochester/i });
    await userEvent.click(pick);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ name: "The Strong, Rochester, NY, USA", city: "Rochester" }),
      ),
    );
  });

  it("renders results as a listbox with primary and secondary text", async () => {
    const onChange = vi.fn();
    render(<LocationInput value={null} onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText(/place/i), "Colosseum");
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    await screen.findByRole("listbox");
    const option = screen.getByRole("option", { name: /Colosseum, Rome/i });
    expect(option.textContent).toContain("Colosseum, Rome, Italy");
    expect(option.textContent).toContain("IT");
  });

  it("pressing Enter in the place-name field searches instead of submitting the surrounding form", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <LocationInput value={null} onChange={onChange} />
      </form>,
    );
    await userEvent.type(screen.getByLabelText(/place name/i), "Colosseum{Enter}");
    await screen.findByRole("listbox");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
