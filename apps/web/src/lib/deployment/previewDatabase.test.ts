import { describe, expect, it } from "vitest";
import { assertPreviewDatabase } from "./previewDatabase";

// M64 part 4: the preview app's runtime DATABASE_URL is set by hand in Coolify.
// A production URL pasted there would let the preview write production, which
// the migrate step's own check cannot see (it guards the Actions secret only).
describe("assertPreviewDatabase", () => {
  const preview = { APP_ENV: "preview" };

  it("refuses a preview that points at any database but caesura_preview", () => {
    for (const url of ["postgres://u:p@db:5432/caesura", "postgres://u:p@db:5432/caesura_preview_old", undefined, "not a url"]) {
      expect(() => assertPreviewDatabase({ ...preview, DATABASE_URL: url })).toThrow(/caesura_preview/);
    }
  });

  it("lets the preview database through, and says nothing about other environments", () => {
    expect(() => assertPreviewDatabase({ ...preview, DATABASE_URL: "postgres://u:p@db:5432/caesura_preview?sslmode=disable" })).not.toThrow();
    expect(() => assertPreviewDatabase({ APP_ENV: "production", DATABASE_URL: "postgres://u:p@db:5432/caesura" })).not.toThrow();
    expect(() => assertPreviewDatabase({ DATABASE_URL: "postgres://localhost/travel" })).not.toThrow();
  });
});
