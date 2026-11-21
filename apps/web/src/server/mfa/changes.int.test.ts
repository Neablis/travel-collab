import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { userFactors, users } from "@/server/db/schema";
import type { Email } from "@/server/email/send";
import { describeClient, recordSecurityChange, turnOffIn } from "./changes";
import { addPasskey, addTotp } from "./factors";
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
    await change(id, { "user-agent": SAFARI_ON_IPHONE, "x-forwarded-for": "203.0.113.9" });
    expect(sent).toHaveLength(1);
    const [mail] = sent as [Email];
    expect(mail).toMatchObject({ to: "ana@gmail.com", tag: "security-change" });
    expect(mail.text).toContain("2026-11-21 09:30 UTC");
    expect(mail.text).toContain("Safari on iOS");
    expect(mail.text).toContain("IP address 203.0.113.9");
    expect(mail.text).toContain("https://caesura.example/account?tab=security");
  });

  // The proxy appends the address that connected to it; anything to its left came
  // from the client, and whoever made the change could have written it.
  it("names the address the proxy appended, not one the client wrote, and a whole IPv6 address", async () => {
    const id = await account("ana@gmail.com");
    await change(id, { "x-forwarded-for": "198.51.100.7, 203.0.113.9" });
    expect(sent[0]!.text).toContain("IP address 203.0.113.9");
    expect(sent[0]!.text).not.toContain("198.51.100.7");
    sent.length = 0;
    await change(id, { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" });
    expect(sent[0]!.text).toContain("IP address 2001:db8:1:2:3:4:5:6");
  });

  it("leaves out the address when there is none, and sends nothing to an account with no email", async () => {
    await change(await account("ana@gmail.com"));
    expect(sent[0]!.text).not.toContain("IP address");
    sent.length = 0;
    await change(await account(null));
    expect(sent).toHaveLength(0);
  });

  // The write is made and then the change fails: only one transaction around both
  // takes the write back with it.
  it("rolls the write and the epoch back together when the change fails after writing", async () => {
    const id = await withTwoStepOn();
    const before = (await mfaStateFor(id)).epoch;
    await expect(
      recordSecurityChange({
        userId: id,
        sid: "a-session",
        change: "two-step-off",
        request: new Request("http://localhost/x"),
        now: new Date(),
        apply: async (tx) => {
          await turnOffIn(tx, id);
          throw new Error("refused");
        },
      }),
    ).rejects.toThrow("refused");
    expect(await mfaStateFor(id)).toEqual({ enabled: true, epoch: before });
    expect(sent).toHaveLength(0);
  });
});

async function withTwoStepOn(): Promise<string> {
  const id = await account("ana@gmail.com");
  await db.update(users).set({ mfaEnabledAt: new Date() }).where(eq(users.id, id));
  return id;
}

// Turn off in one tab and an add in another, at once (READ COMMITTED). Each takes
// the account's row first, so one waits for the other rather than leaving a factor
// stored with two-step sign-in off.
describe("a change racing an add on the same account", () => {
  /** Holds the account's row as a change in progress would, until the returned release. */
  async function holding(id: string) {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    const done = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update");
      locked();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await held;
    return async () => {
      release();
      await done;
    };
  }

  const settlesWithin = (work: Promise<unknown>, ms: number) =>
    Promise.race([work.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

  const adds = {
    passkey: (id: string) =>
      addPasskey(id, { credentialId: randomUUID(), publicKey: "key", counter: 0, transports: [], name: "Passkey" }, new Date()),
    // The secret is never opened here, so any sealed string will do.
    "authenticator app": (id: string) => addTotp(id, { factorId: randomUUID(), sealedSecret: "sealed", step: 1 }, new Date()),
  };

  // With two-step sign-in on, the add's conditional UPDATE matches no row and so
  // never waits on its own: only taking the row first makes it.
  for (const [kind, add] of Object.entries(adds)) {
    it(`an add (${kind}) waits for the account's row, even when two-step sign-in is already on`, async () => {
      const id = await withTwoStepOn();
      const release = await holding(id);
      const adding = add(id);
      expect(await settlesWithin(adding, 300)).toBe(false);
      await release();
      expect(await adding).toEqual({ recoveryCodes: null });
    });
  }

  it("Turn off takes the account's row before it deletes, so a factor added meanwhile goes too", async () => {
    const id = await withTwoStepOn();
    const release = await holding(id);
    const turningOff = db.transaction((tx) => turnOffIn(tx, id));
    expect(await settlesWithin(turningOff, 300)).toBe(false);
    // Committed while Turn off waits: it must still be gone once Turn off is done.
    await db.insert(userFactors).values({ id: randomUUID(), userId: id, kind: "passkey", name: "Added meanwhile", createdAt: new Date() });
    await release();
    await turningOff;
    expect(await db.select().from(userFactors).where(eq(userFactors.userId, id))).toHaveLength(0);
    expect((await mfaStateFor(id)).enabled).toBe(false);
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
