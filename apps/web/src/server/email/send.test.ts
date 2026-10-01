import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromAddress, isDeliverable, sendEmail, type Email } from "./send";

const email: Email = { to: "ana@gmail.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", tag: "welcome" };

function okFetch(id = "msg_1") {
  return vi.fn<typeof fetch>(async () => Response.json({ id }));
}

describe("sendEmail", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "caesura.today");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts one message to Resend with the key, sender, recipient and reply-to", async () => {
    const fetchImpl = okFetch();
    const outcome = await sendEmail({ ...email, replyTo: "owner@gmail.com" }, fetchImpl);

    expect(outcome).toEqual({ sent: true, id: "msg_1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init!.headers).get("Authorization")).toBe("Bearer re_test");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      from: "Caesura <hello@caesura.today>",
      to: ["ana@gmail.com"],
      subject: "Hi",
      reply_to: "owner@gmail.com",
      tags: [{ name: "touchpoint", value: "welcome" }],
    });
  });

  it("sends nothing without an API key — the local, CI and e2e default", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = okFetch();
    expect(await sendEmail(email, fetchImpl)).toEqual({ sent: false, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends nothing to a reserved domain, which is where dev-login mail goes by default", async () => {
    const fetchImpl = okFetch();
    const outcome = await sendEmail({ ...email, to: "dev+alice@example.com" }, fetchImpl);
    expect(outcome).toEqual({ sent: false, reason: "undeliverable-address" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers a Resend refusal instead of throwing it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("domain not verified", { status: 403 }));
    expect(await sendEmail(email, fetchImpl)).toEqual({ sent: false, reason: "rejected" });
  });

  it("answers a network failure instead of throwing it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sendEmail(email, fetchImpl)).toEqual({ sent: false, reason: "failed" });
  });
});

describe("fromAddress", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("takes a full address as-is, so the mailbox can change from the dashboard", () => {
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "trips@mail.caesura.today");
    expect(fromAddress()).toBe("Caesura <trips@mail.caesura.today>");
  });

  it("is null when unset", () => {
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "");
    expect(fromAddress()).toBeNull();
  });
});

describe("isDeliverable", () => {
  it.each([
    ["ana@gmail.com", true],
    ["dev+bob@example.com", false],
    ["x@mail.example.org", false],
    ["x@host.test", false],
    ["no-at-sign", false],
    ["a@b@c.com", false],
  ])("%s → %s", (address, expected) => {
    expect(isDeliverable(address)).toBe(expected);
  });
});
