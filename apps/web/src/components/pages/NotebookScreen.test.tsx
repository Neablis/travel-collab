import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { NotebookScreen } from "./NotebookScreen";
import { pageFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => pushMock.mockClear());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("NotebookScreen", () => {
  it("lists pages with title, binding, and last-edited", async () => {
    const tripWide = pageFixture({ id: "11111111-1111-4111-8111-111111111111", title: "Trip Overview" });
    const dayBound = pageFixture({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Day Sheet",
      context: { tripId: TRIP_ID, dayRef: { kind: "index", index: 0 } },
    });
    server.use(...makePagesHandlers([tripWide, dayBound]));

    render(<NotebookScreen tripId={TRIP_ID} />);

    expect(await screen.findByText("Trip Overview")).toBeTruthy();
    expect(screen.getByText("Day Sheet")).toBeTruthy();
    expect(screen.getByText(/Day 1/)).toBeTruthy();
    expect(screen.getAllByText(/Trip-wide|Updated/).length).toBeGreaterThan(0);
  });

  it("creates a new page via the client and navigates to it", async () => {
    const onCreate = vi.fn();
    server.use(...makePagesHandlers([], { onCreate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /New page/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/trips/${TRIP_ID}/pages/`)));
  });

  it("renames a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onUpdate = vi.fn();
    server.use(...makePagesHandlers([page], { onUpdate }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    expect(await screen.findByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Rename ${page.title}` }));
    const input = screen.getByLabelText(`Rename ${page.title}`) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed Page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(page.id, expect.objectContaining({ title: "Renamed Page" })),
    );
    expect(await screen.findByText("Renamed Page")).toBeTruthy();
  });

  it("deletes a page via the client", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    const onDelete = vi.fn();
    server.use(...makePagesHandlers([page], { onDelete }));

    render(<NotebookScreen tripId={TRIP_ID} />);
    expect(await screen.findByText(page.title)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Delete ${page.title}` }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(page.id));
    await waitFor(() => expect(screen.queryByText(page.title)).toBeNull());
  });
});
