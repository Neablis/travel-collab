import { describe, expect, it } from "vitest";
import { tripInviteEmail, welcomeEmail } from "./templates";

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
