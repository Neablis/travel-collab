// The cached copy's layout. It is only cacheable while it reads no session:
// `servedForRequest` reads cookies, and one call would make Next render every
// cached page per request with nothing failing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const servedForRequest = vi.hoisted(() => vi.fn());
vi.mock("@/server/servedSession", () => ({ servedForRequest }));

import CachedPlaybooksLayout from "./layout";

type Shell = React.ReactElement<{ noSessionCookie: boolean; served: unknown }>;
const render = async (copy: string) =>
  (await CachedPlaybooksLayout({ children: null, params: Promise.resolve({ copy }) })) as Shell;

beforeEach(() => {
  servedForRequest.mockReset().mockResolvedValue({ noSessionCookie: false, served: { user: { id: "user-a" } } });
});

describe("the cached copy's layout", () => {
  it("draws the signed-out shell, reading no session", async () => {
    const shell = await render("cached");
    expect(servedForRequest).not.toHaveBeenCalled();
    expect(shell.props).toMatchObject({ noSessionCookie: true, served: null });
  });

  it("is a 404 for any copy proxy.ts does not write", async () => {
    await expect(render("live")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
