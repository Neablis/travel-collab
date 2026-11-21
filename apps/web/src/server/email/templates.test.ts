import { describe, expect, it } from "vitest";
import { securityChangeEmail, tripInviteEmail, welcomeEmail } from "./templates";

describe("tripInviteEmail", () => {
  const base = {
    to: "friend@gmail.com",
    inviterName: "Ana",
    inviterEmail: "ana@gmail.com",
    tripName: "Kyoto in April",
    role: "editor" as const,
    inviteUrl: "https://caesura.today/invite/tok-123",
  };

  it("names the inviter and the trip, links the invite, and replies to the inviter", () => {
    const mail = tripInviteEmail(base);
    expect(mail.subject).toBe("Ana invited you to Kyoto in April");
    expect(mail.replyTo).toBe("ana@gmail.com");
    expect(mail.html).toContain('href="https://caesura.today/invite/tok-123"');
    expect(mail.text).toContain("Open the invite: https://caesura.today/invite/tok-123");
    expect(mail.text).toContain("Ana invited you to plan Kyoto in April");
  });

  it("tells a viewer they can see the trip, not plan it", () => {
    expect(tripInviteEmail({ ...base, role: "viewer" }).text).toContain("invited you to see Kyoto in April");
  });

  it("tells a suggester they can suggest changes, for the trip's planners to approve", () => {
    const mail = tripInviteEmail({ ...base, role: "suggester" });
    expect(mail.text).toContain("invited you to suggest changes to Kyoto in April");
    expect(mail.text).toContain("You'll be able to suggest changes for the trip's planners to approve.");
  });

  it("escapes a user-typed trip name and inviter name, so neither can inject markup", () => {
    const mail = tripInviteEmail({ ...base, tripName: '<a href="https://evil">Win</a>', inviterName: "<b>Eve</b>" });
    expect(mail.html).not.toContain('<a href="https://evil">');
    expect(mail.html).not.toContain("<b>Eve</b>");
    expect(mail.html).toContain("&lt;a href=&quot;https://evil&quot;&gt;Win&lt;/a&gt;");
  });

  it("falls back to 'Someone' and offers no reply line when the inviter has no row", () => {
    const mail = tripInviteEmail({ ...base, inviterName: null, inviterEmail: null });
    expect(mail.subject).toBe("Someone invited you to Kyoto in April");
    expect(mail.replyTo).toBeNull();
    expect(mail.html).not.toContain("Reply to this email");
  });
});

describe("welcomeEmail", () => {
  it("greets by name and links back to the app", () => {
    const mail = welcomeEmail({ to: "ana@gmail.com", name: "Ana", appUrl: "https://caesura.today" });
    expect(mail.subject).toBe("Welcome to Caesura");
    expect(mail.text).toContain("Welcome, Ana.");
    expect(mail.html).toContain('href="https://caesura.today"');
  });

  it("escapes the name", () => {
    const mail = welcomeEmail({ to: "a@gmail.com", name: "<script>x</script>", appUrl: "https://caesura.today" });
    expect(mail.html).not.toContain("<script>");
  });
});

describe("securityChangeEmail", () => {
  const base = {
    to: "ana@gmail.com",
    change: "two-step-off" as const,
    at: new Date("2026-11-21T09:30:00.000Z"),
    client: "Safari on iOS",
    ip: "203.0.113.9",
    securityUrl: "https://caesura.today/account?tab=security",
  };

  it("says what changed, when, and from where, and links the security settings", () => {
    const mail = securityChangeEmail(base);
    expect(mail.tag).toBe("security-change");
    expect(mail.subject).toBe("Two-step sign-in was turned off");
    expect(mail.text).toContain("When: 2026-11-21 09:30 UTC");
    expect(mail.text).toContain("From: Safari on iOS, IP address 203.0.113.9");
    expect(mail.html).toContain('href="https://caesura.today/account?tab=security"');
  });

  it("leaves the From line out when neither the browser nor the address is known", () => {
    expect(securityChangeEmail({ ...base, client: null, ip: null }).text).not.toContain("From:");
  });

  it("has its own wording for each change", () => {
    expect(securityChangeEmail({ ...base, change: "codes-regenerated" }).subject).toBe("Your recovery codes were replaced");
    expect(securityChangeEmail({ ...base, change: "factor-removed" }).subject).toBe("A second step was removed from your account");
  });

  it("escapes a user-agent-derived string", () => {
    expect(securityChangeEmail({ ...base, client: "<script>x</script>" }).html).not.toContain("<script>");
  });
});
