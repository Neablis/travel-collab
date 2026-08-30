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

  // The whole reason this is an enum rather than a string: the value arrives
  // off `/signin?error=`, which anyone can type. If a schema is what stands
  // between that param and the copy map, the schema has to actually refuse.
  it.each<string>([
    "NOT_A_REAL_CODE",
    "missing_invite_code",
    "MISSING_INVITE_CODE ",
    "__proto__",
    "constructor",
    "toString",
    "MISSING_INVITE_CODE|INVALID_INVITE_CODE",
    ".*",
    "",
  ])("refuses the arbitrary ?error= value %j", (value) => {
    expect(AdmissionRefusal.safeParse(value).success).toBe(false);
  });

  it.each<string>(["MISSING_INVITE_CODE", "INVALID_INVITE_CODE", "SPENT_INVITE_CODE"])(
    "accepts %s",
    (value) => {
      expect(AdmissionRefusal.parse(value)).toBe(value);
    },
  );

  it.each<unknown>([null, undefined, 42, {}, []])("refuses the non-string %j", (value) => {
    expect(AdmissionRefusal.safeParse(value).success).toBe(false);
  });
});
