import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { Email } from "@/server/email/send";
import { describeClient, recordSecurityChange } from "./changes";
import { mfaStateFor } from "./state";

// The mail provider is the only thing replaced: what the account is told is the
// subject of these tests, and the epoch and the write are the real tables.
const sent = vi.hoisted(() => [] as Email[]);
vi.mock("@/server/email/send", () => ({
  sendEmail: async (email: Email) => {
    sent.push(email);
    return { sent: true, id: null };
  },
}));
beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("PUBLIC_ORIGIN", "https://caesura.example");
});

async function account(email: string | null): Promise<string> {
  const id = `dev-${randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(users).values({ id, email, createdAt: now, updatedAt: now });
  return id;
}

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function change(userId: string, headers: Record<string, string> = {}) {
  return recordSecurityChange({
    userId,
    sid: "a-session",
    change: "factor-removed",
    request: new Request("http://localhost/x", { method: "DELETE", headers }),
    now: new Date("2026-11-21T09:30:00.000Z"),
    apply: async () => "done",
  });
}

describe("recordSecurityChange", () => {
  it("bumps the epoch once and hands back the apply result with a proof for this session", async () => {
    const id = await account("ana@gmail.com");
    const before = (await mfaStateFor(id)).epoch;
    const { result, proof } = await change(id);
    expect(result).toBe("done");
    expect((await mfaStateFor(id)).epoch).toBe(before + 1);
    expect(proof).toMatchObject({ method: "epoch", epoch: before + 1 });
  });

  it("emails the account what changed, when, and from what browser and address, and no place", async () => {
    const id = await account("ana@gmail.com");
    await change(id, { "user-agent": SAFARI_ON_IPHONE, "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(sent).toHaveLength(1);
    const [mail] = sent as [Email];
    expect(mail).toMatchObject({ to: "ana@gmail.com", tag: "security-change" });
    expect(mail.text).toContain("2026-11-21 09:30 UTC");
    expect(mail.text).toContain("Safari on iOS");
    expect(mail.text).toContain("203.0.113.9");
    expect(mail.text).not.toContain("10.0.0.1");
    expect(mail.text).toContain("https://caesura.example/account?tab=security");
  });

  it("leaves out the address when there is none, and sends nothing to an account with no email", async () => {
    await change(await account("ana@gmail.com"));
    expect(sent[0]!.text).not.toContain("IP address");
    sent.length = 0;
    await change(await account(null));
    expect(sent).toHaveLength(0);
  });

  it("rolls the epoch back with the write when the write fails", async () => {
    const id = await account("ana@gmail.com");
    const before = (await mfaStateFor(id)).epoch;
    await expect(
      recordSecurityChange({
        userId: id,
        sid: "a-session",
        change: "two-step-off",
        request: new Request("http://localhost/x"),
        now: new Date(),
        apply: async () => {
          throw new Error("refused");
        },
      }),
    ).rejects.toThrow("refused");
    expect((await mfaStateFor(id)).epoch).toBe(before);
    expect(sent).toHaveLength(0);
  });
});

describe("describeClient", () => {
  it("names a browser and a system and no version", () => {
    expect(describeClient(SAFARI_ON_IPHONE)).toBe("Safari on iOS");
    expect(describeClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0")).toBe("Edge on Windows");
    expect(describeClient("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe("Firefox on Linux");
  });

  it("is null for a header that is absent or names nothing", () => {
    expect(describeClient(null)).toBeNull();
    expect(describeClient("curl/8.0")).toBeNull();
  });
});
