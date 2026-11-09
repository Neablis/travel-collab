import { describe, expect, it } from "vitest";
import { evalMayFetch } from "./evalNetworkGuard.setup";

// The eval lane reaches one third party, the model, and nothing else: weather,
// place search and link previews would spend money and vary between runs for
// reasons that are not the model's.
describe("evalMayFetch", () => {
  it("admits this machine and the model providers", () => {
    expect(evalMayFetch("http://localhost:3000/api")).toBe(true);
    expect(evalMayFetch("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(evalMayFetch("https://api.openai.com/v1/embeddings")).toBe(true);
  });

  it("refuses every other host, including look-alikes", () => {
    expect(evalMayFetch("https://api.met.no/weatherapi")).toBe(false);
    expect(evalMayFetch("https://us1.locationiq.com/v1/search")).toBe(false);
    expect(evalMayFetch("https://api.anthropic.com.evil.example/")).toBe(false);
    expect(evalMayFetch("https://evil.example/?api.anthropic.com")).toBe(false);
  });
});
