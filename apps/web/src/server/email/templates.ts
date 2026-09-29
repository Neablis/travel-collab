import type { Email } from "./send";

// The words of every email the product sends, and nothing else: each builder
// takes plain strings and returns an `Email` for `sendEmail`. Pure, so the
// unit suite reads exactly what a recipient would.
//
// **Every interpolated value is escaped.** A trip's name and a person's display
// name are typed by users, and an email client renders HTML — a trip called
// `<a href=…>` must arrive as text, not as a link somebody else wrote.
//
// Inline styles and one table-free column, because that is what survives
// Gmail, Outlook and Apple Mail alike. Colours are the app's light-theme
// tokens (`globals.css`: ink, slate, paper, hairline).

const INK = "#151d2e";
const SLATE = "#5a6472";
const PAPER = "#f7f8f6";
const HAIRLINE = "#dde2da";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The shared frame: a heading, some paragraphs, one button, a footer line. */
function layout(parts: { heading: string; paragraphs: string[]; cta: { label: string; href: string }; footer: string }): string {
  const paragraphs = parts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK}">${p}</p>`)
    .join("");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${PAPER}">
<div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<p style="margin:0 0 32px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${SLATE}">Caesura</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;font-weight:600;color:${INK}">${parts.heading}</h1>
${paragraphs}
<p style="margin:28px 0"><a href="${escapeHtml(parts.cta.href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${INK};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${parts.cta.label}</a></p>
<p style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${HAIRLINE};font-size:12px;line-height:1.5;color:${SLATE}">${parts.footer}</p>
</div>
</body></html>`;
}

/** Sent once, when an account is created (`recordSignIn`, first sign-in only). */
export function welcomeEmail(input: { to: string; name: string | null; appUrl: string }): Email {
  const greeting = input.name ? `Welcome, ${input.name}.` : "Welcome to Caesura.";
  return {
    to: input.to,
    tag: "welcome",
    subject: "Welcome to Caesura",
    html: layout({
      heading: escapeHtml(greeting),
      paragraphs: [
        "Your account is ready. Start a trip, lay out the days, and invite the people you're travelling with to plan it alongside you.",
        "Every change is kept, so you can always go back to an earlier version of the plan.",
      ],
      cta: { label: "Start planning", href: input.appUrl },
      footer: "You're receiving this because you just created a Caesura account.",
    }),
    text: [
      greeting,
      "",
      "Your account is ready. Start a trip, lay out the days, and invite the people you're travelling with to plan it alongside you.",
      "",
      "Every change is kept, so you can always go back to an earlier version of the plan.",
      "",
      `Start planning: ${input.appUrl}`,
      "",
      "You're receiving this because you just created a Caesura account.",
    ].join("\n"),
  };
}

/** Sent when a trip owner invites someone by email address. */
export function tripInviteEmail(input: {
  to: string;
  inviterName: string | null;
  inviterEmail: string | null;
  tripName: string;
  role: "editor" | "viewer";
  inviteUrl: string;
}): Email {
  const who = input.inviterName ?? "Someone";
  const action = input.role === "editor" ? "plan" : "see";
  const lead = `${who} invited you to ${action} ${input.tripName} on Caesura.`;
  const ignoreLine = "If you weren't expecting this, you can ignore it — nothing happens unless you open the link.";
  const body =
    input.role === "editor"
      ? "You'll be able to add days and activities and shape the plan together."
      : "You'll be able to follow the plan as it comes together.";
  return {
    to: input.to,
    tag: "trip-invite",
    replyTo: input.inviterEmail,
    subject: `${who} invited you to ${input.tripName}`,
    html: layout({
      heading: `${escapeHtml(who)} invited you to <span style="white-space:nowrap">${escapeHtml(input.tripName)}</span>`,
      paragraphs: [escapeHtml(lead), body],
      cta: { label: "Open the invite", href: input.inviteUrl },
      footer: escapeHtml(ignoreLine + (input.inviterEmail ? ` Reply to this email to reach ${who}.` : "")),
    }),
    text: [lead, "", body, "", `Open the invite: ${input.inviteUrl}`, "", ignoreLine].join("\n"),
  };
}
