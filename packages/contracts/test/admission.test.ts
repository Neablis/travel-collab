import { describe, expect, it } from "vitest";
import { AdmissionRefusal } from "../src";

describe("AdmissionRefusal", () => {
  it("is exactly the three refusals the gate can produce", () => {
    expect(AdmissionRefusal.options).toEqual([
      "MISSING_INVITE_CODE",
      "INVALID_INVITE_CODE",
      "SPENT_INVITE_CODE",
    ]);
  });

  it.each<string>(["MISSING_INVITE_CODE", "INVALID_INVITE_CODE", "SPENT_INVITE_CODE"])(
    "accepts %s",
    (value) => {
      expect(AdmissionRefusal.parse(value)).toBe(value);
    },
  );

  // The whole reason this is an enum rather than a string: the value arrives
  // off `/signin?error=`, which anyone can type. If a schema is what stands
  // between that param and the copy map, the schema has to actually refuse.
  // The prototype keys are here because the map this guards is an object and
  // the old lookup path needed an `Object.hasOwn` guard for exactly them.
  it.each<string>([
    "NOT_A_REAL_CODE",
    "InviteRequired",
    "missing_invite_code",
    "MISSING_INVITE_CODE ",
    "__proto__",
    "constructor",
    "toString",
    "MISSING_INVITE_CODE|INVALID_INVITE_CODE",
    ".*",
    "AccessDenied",
    "",
  ])("refuses the arbitrary ?error= value %j", (value) => {
    expect(AdmissionRefusal.safeParse(value).success).toBe(false);
  });

  it.each<unknown>([null, undefined, 42, {}, [], ["MISSING_INVITE_CODE"]])(
    "refuses the non-string %j",
    (value) => {
      expect(AdmissionRefusal.safeParse(value).success).toBe(false);
    },
  );

  // `.enum` is how every producer is meant to spell a member (never a literal),
  // so it is pinned here rather than left as a convention in a comment.
  it("exposes each member by name for callers that must not spell the literal", () => {
    expect(AdmissionRefusal.enum.MISSING_INVITE_CODE).toBe("MISSING_INVITE_CODE");
    expect(AdmissionRefusal.enum.INVALID_INVITE_CODE).toBe("INVALID_INVITE_CODE");
    expect(AdmissionRefusal.enum.SPENT_INVITE_CODE).toBe("SPENT_INVITE_CODE");
  });
});
