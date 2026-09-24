import { describe, expect, it } from "vitest";
import {
  CreateSavedNotebookInput,
  SavedNotebook,
  SavedNotebookListResponse,
  SavedNotebookSummary,
  SavedNotebookVisibility,
} from "../src";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const pageId = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const savedNotebook = {
  savedNotebookId: "3c5e7f90-2222-4333-8444-555566667777",
  ownerId: "dev-alice",
  title: "Day overview",
  docVersion: 1,
  visibility: "private",
  provenance: { sourceTripId: tripId, sourceTripName: "Kyoto", sourcePageId: pageId, savedAt: "2026-09-24T00:00:00.000Z" },
  content: { v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
};

describe("SavedNotebook", () => {
  it("round-trips, snapshot and provenance included", () => {
    expect(SavedNotebook.parse(savedNotebook)).toEqual(savedNotebook);
  });

  // ADR-029: private by default, publishable LATER. A contract that accepted
  // "public" now would describe a state no endpoint produces.
  it("is private, and has no public state yet", () => {
    expect(SavedNotebookVisibility.options).toEqual(["private"]);
    expect(SavedNotebook.safeParse({ ...savedNotebook, visibility: "public" }).success).toBe(false);
  });

  // The list omits the document for `PageSummary`'s reason — it is the one
  // unbounded field, and the gallery never renders it.
  it("lists without the document", () => {
    const summary = SavedNotebookSummary.parse(savedNotebook);
    expect(summary).not.toHaveProperty("content");
    expect(SavedNotebookListResponse.parse({ savedNotebooks: [savedNotebook] }).savedNotebooks[0]).not.toHaveProperty(
      "content",
    );
  });

  // Read-permissive, `Page.content`'s rule: a snapshot must come back to its
  // owner even when its nodes are ones this build does not know.
  it("reads a snapshot whose nodes this build does not know", () => {
    const future = { ...savedNotebook, content: { v: 1, type: "doc", content: [{ type: "someday", x: 1 }] } };
    expect(SavedNotebook.safeParse(future).success).toBe(true);
  });
});

describe("CreateSavedNotebookInput", () => {
  it("takes a page and an optional title", () => {
    expect(CreateSavedNotebookInput.parse({ tripId, pageId })).toEqual({ tripId, pageId });
    expect(CreateSavedNotebookInput.parse({ tripId, pageId, title: "  Mine  " }).title).toBe("Mine");
  });

  it("refuses a blank title rather than saving an unnamed template", () => {
    expect(CreateSavedNotebookInput.safeParse({ tripId, pageId, title: "   " }).success).toBe(false);
  });

  // The server snapshots what the log holds. A document in the request would
  // let a client save a template the trip never contained.
  it("carries no document, and strips one that is supplied", () => {
    const parsed = CreateSavedNotebookInput.parse({ tripId, pageId, content: { type: "doc", content: [] } });
    expect(parsed).not.toHaveProperty("content");
  });
});
