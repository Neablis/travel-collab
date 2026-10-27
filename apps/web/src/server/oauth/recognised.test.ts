import { describe, expect, it } from "vitest";
import { consentMarking } from "./recognised";

// Amendment F. The page names a client only when the code goes to claude.ai;
// a loopback redirect is a program on this computer, whoever it claims to be.

describe("consentMarking", () => {
  it("recognises Claude's own callback", () => {
    expect(consentMarking("https://claude.ai/api/mcp/auth_callback")).toBe("recognised");
  });

  // Claude Code presents a public CIMD (`https://claude.ai/oauth/claude-code-client-metadata`)
  // with a loopback redirect, and so can anyone else.
  it("warns about Claude Code's CIMD with a loopback redirect, and never recognises it", () => {
    expect(consentMarking("http://localhost:54321/callback")).toBe("localhost-warning");
    expect(consentMarking("http://127.0.0.1:54321/callback")).toBe("localhost-warning");
  });

  it("calls anything else unverified, a near miss of Claude's callback included", () => {
    expect(consentMarking("https://example.com/cb")).toBe("unverified");
    expect(consentMarking("https://claude.ai/api/mcp/auth_callback/")).toBe("unverified");
  });
});
