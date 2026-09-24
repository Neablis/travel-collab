import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { makeSavedNotebookHandlers } from "@/mocks/handlers";
import { SaveAsTemplate } from "./SaveAsTemplate";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const PAGE_ID = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("SaveAsTemplate", () => {
  // M14 link 10: "name defaults to the page title" — accepting it is one Enter.
  it("saves the page under its own title by default", async () => {
    const onSave = vi.fn();
    server.use(...makeSavedNotebookHandlers([], { onSave }));
    render(<SaveAsTemplate tripId={TRIP_ID} pageId={PAGE_ID} title="Packing list" />);

    await userEvent.click(screen.getByRole("button", { name: "Save as template" }));
    const name = screen.getByLabelText("Name");
    expect((name as HTMLInputElement).value).toBe("Packing list");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ tripId: TRIP_ID, pageId: PAGE_ID, title: "Packing list" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Saved “Packing list” to your templates");
  });

  it("saves under the name typed instead", async () => {
    const onSave = vi.fn();
    server.use(...makeSavedNotebookHandlers([], { onSave }));
    render(<SaveAsTemplate tripId={TRIP_ID} pageId={PAGE_ID} title="Packing list" />);

    await userEvent.click(screen.getByRole("button", { name: "Save as template" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Beach trip packing");
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Beach trip packing" })));
  });

  it("refuses a blank name without asking the server", async () => {
    const onSave = vi.fn();
    server.use(...makeSavedNotebookHandlers([], { onSave }));
    render(<SaveAsTemplate tripId={TRIP_ID} pageId={PAGE_ID} title="Packing list" />);

    await userEvent.click(screen.getByRole("button", { name: "Save as template" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Give the template a name.");
    expect(onSave).not.toHaveBeenCalled();
  });
});
