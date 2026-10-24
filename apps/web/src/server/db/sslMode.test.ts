import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withExplicitSslMode } from "./sslMode";

const NEON = "postgresql://user:p%40ss@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("withExplicitSslMode (KI-2026-10-03-b)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // First in the file on purpose: pg-connection-string warns once per process,
  // so this has to be the first string pg parses here to be able to fail.
  it("lets pg parse Neon's string without the SECURITY WARNING, and with the same ssl config", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const client = new Client({ connectionString: withExplicitSslMode(NEON) });
    expect(warn).not.toHaveBeenCalled();
    // `{}` is pg's "TLS on, verify the server": what `require` already meant.
    // `connectionParameters` is real but missing from @types/pg.
    const params = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters;
    expect(params.ssl).toEqual({});
  });

  it("rewrites each alias pg@8 treats as verify-full, and nothing else in the string", () => {
    for (const mode of ["prefer", "require", "verify-ca"]) {
      expect(withExplicitSslMode(`postgres://u:p%2F@h:5432/db?sslmode=${mode}&x=1`)).toBe(
        "postgres://u:p%2F@h:5432/db?sslmode=verify-full&x=1",
      );
    }
  });

  it("leaves verify-full, disable, no sslmode and a libpq-compat string alone", () => {
    for (const s of [
      "postgres://u:p@h/db?sslmode=verify-full",
      "postgres://u:p@h/db?sslmode=disable",
      "postgres://u:p@localhost:5433/travel",
      "postgres://u:p@h/db?uselibpqcompat=true&sslmode=require",
    ]) {
      expect(withExplicitSslMode(s)).toBe(s);
    }
  });
});
