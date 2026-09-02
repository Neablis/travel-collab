import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/apiClient";
import { useLibraryRead } from "./useLibraryRead";

// The conflict half of project rule 6, tested on the hook rather than through a
// screen: the four public-library routes each expose `reload` from a different
// control, and the property being guarded — WHICH re-read counts as "the
// library moved" — is the hook's, not any one screen's.

const ok = <T,>(value: T): ApiResult<T> => ({ ok: true, value });

afterEach(cleanup);

/** The surface's signature is the whole payload here; the shape is beside the point. */
const signature = (value: string) => value;

describe("useLibraryRead's changed signal", () => {
  // The genuine case: the SAME question, asked again, answered differently.
  // Somebody published, withdrew or took a day while the page sat open.
  it("reports a reload that brings back something different", async () => {
    const read = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useLibraryRead(read, signature));
    await waitFor(() => expect(result.current.data).toBe("a"));
    expect(result.current.changed).toBe(false);

    read.mockResolvedValue(ok("b"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.changed).toBe(true));
    expect(result.current.data).toBe("b");

    act(() => result.current.acknowledgeChange());
    expect(result.current.changed).toBe(false);
  });

  it("says nothing when a reload brings back the same answer", async () => {
    const read = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useLibraryRead(read, signature));
    await waitFor(() => expect(result.current.data).toBe("a"));

    act(() => result.current.reload());
    // `read`'s call count moves when it is INVOKED, and `reload()` invokes it
    // synchronously — so waiting on the count is not waiting for the answer, and
    // `changed` was read before the hook had compared anything. `loading` going
    // back to false is the settle point.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.changed).toBe(false);
  });

  // The regression (CodeRabbit, PR 102). Discover rebuilds `read` on every
  // filter change, so before this the banner fired on essentially every
  // interaction — a different answer to a DIFFERENT question read as the
  // library moving.
  it("does not report a new read as a change, however different its answer", async () => {
    const first = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const second = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("z"));
    const { result, rerender } = renderHook(
      ({ read }: { read: () => Promise<ApiResult<string>> }) => useLibraryRead(read, signature),
      { initialProps: { read: first } },
    );
    await waitFor(() => expect(result.current.data).toBe("a"));

    rerender({ read: second });
    await waitFor(() => expect(result.current.data).toBe("z"));
    expect(result.current.changed).toBe(false);
  });

  // …and a banner already on screen is about the old question, so it goes with
  // it rather than sitting over an answer it was never about.
  it("puts an existing banner away when the question changes", async () => {
    const first = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result, rerender } = renderHook(
      ({ read }: { read: () => Promise<ApiResult<string>> }) => useLibraryRead(read, signature),
      { initialProps: { read: first } },
    );
    await waitFor(() => expect(result.current.data).toBe("a"));
    first.mockResolvedValue(ok("b"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.changed).toBe(true));

    const second = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("c"));
    rerender({ read: second });
    await waitFor(() => expect(result.current.data).toBe("c"));
    expect(result.current.changed).toBe(false);
  });

  // KI-20260831, the third face of the same mistake: a difference the reader
  // already knows about, reported as news. The shared day re-reads after its
  // own publish, and `visibility` is half its signature.
  it("says nothing about a refresh the caller made itself", async () => {
    const read = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useLibraryRead(read, signature));
    await waitFor(() => expect(result.current.data).toBe("a"));

    read.mockResolvedValue(ok("b"));
    act(() => result.current.refreshWithoutComparing());
    await waitFor(() => expect(result.current.data).toBe("b"));
    expect(result.current.changed).toBe(false);
  });

  // The half that keeps the fix from being a deletion of the feature. A silent
  // refresh moves the baseline forward; it does not switch the comparison off,
  // so the next genuine external change is caught — and is measured against
  // what the caller's own write left on screen, not against what preceded it.
  it("still reports a genuine change after a refresh the caller made itself", async () => {
    const read = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useLibraryRead(read, signature));
    await waitFor(() => expect(result.current.data).toBe("a"));

    read.mockResolvedValue(ok("b"));
    act(() => result.current.refreshWithoutComparing());
    await waitFor(() => expect(result.current.data).toBe("b"));

    read.mockResolvedValue(ok("c"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.changed).toBe(true));
    expect(result.current.data).toBe("c");
  });

  // …and the baseline really is "b" and not the stale "a": a reload that brings
  // back exactly what the caller's own write produced is not a change either.
  // Without moving the baseline the bug would only be deferred by one read.
  it("does not report the caller's own write again on the next reload", async () => {
    const read = vi.fn<() => Promise<ApiResult<string>>>().mockResolvedValue(ok("a"));
    const { result } = renderHook(() => useLibraryRead(read, signature));
    await waitFor(() => expect(result.current.data).toBe("a"));

    read.mockResolvedValue(ok("b"));
    act(() => result.current.refreshWithoutComparing());
    await waitFor(() => expect(result.current.data).toBe("b"));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current.changed).toBe(false);
  });
});
