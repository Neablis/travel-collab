import { describe, expect, it } from "vitest";
import { AdmissionRefusal } from "../src";

describe("AdmissionRefusal", () => {
  it("accepts exactly its three members", () => {
    expect(AdmissionRefusal.options).toEqual([
      "MISSING_INVITE_CODE",
      "INVALID_INVITE_CODE",
      "SPENT_INVITE_CODE",
    ]);
    for (const member of AdmissionRefusal.options) {
      expect(AdmissionRefusal.parse(member)).toBe(member);
    }
  });

  // The whole reason this is an enum and not a string: the refusal reaches the
  // front door through a URL query parameter, which anyone can type. A random
  // value must not be able to pose as a refusal this app produced.
  it("rejects an arbitrary string", () => {
    for (const notARefusal of [
      "InviteRequired",
      "missing_invite_code",
      "MISSING_INVITE_CODE ",
      "",
      "AccessDenied",
    ]) {
      expect(AdmissionRefusal.safeParse(notARefusal).success).toBe(false);
    }
  });

  it("rejects a non-string", () => {
    for (const notAString of [null, undefined, 0, {}, ["MISSING_INVITE_CODE"]]) {
      expect(AdmissionRefusal.safeParse(notAString).success).toBe(false);
    }
  });

  // `.enum` is how every producer is meant to spell a member (never a literal),
  // so it is pinned here rather than left as a convention in a comment.
  it("exposes each member by name for callers that must not spell the literal", () => {
    expect(AdmissionRefusal.enum.MISSING_INVITE_CODE).toBe("MISSING_INVITE_CODE");
    expect(AdmissionRefusal.enum.INVALID_INVITE_CODE).toBe("INVALID_INVITE_CODE");
    expect(AdmissionRefusal.enum.SPENT_INVITE_CODE).toBe("SPENT_INVITE_CODE");
  });
});
