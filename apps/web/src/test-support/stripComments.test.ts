import { describe, expect, it } from "vitest";
import { stripComments } from "./stripComments";

// The two holes the regex versions had, as tests. Both are real shapes from
// this repo rather than invented ones.
describe("stripComments", () => {
  it("removes line and block comments", () => {
    expect(stripComments("const a = 1; // gone\n/* also gone */ const b = 2;")).toContain("const a = 1;");
    expect(stripComments("const a = 1; // gone\n/* also gone */ const b = 2;")).not.toContain("gone");
    expect(stripComments("const a = 1; // gone\n/* also gone */ const b = 2;")).toContain("const b = 2;");
  });

  // Hole 1: a `//` comment naming `@/server/*` opened a block comment that ate
  // everything up to the next `*/`.
  it("does not let a path glob inside a line comment eat the file", () => {
    const source = '// the wall forbids importing @/server/*\nconst KEEP = "MRR";\n{/* a jsx comment */}\nconst ALSO = 1;';
    const code = stripComments(source);
    expect(code).toContain("KEEP");
    expect(code).toContain("MRR");
    expect(code).toContain("ALSO");
    expect(code).not.toContain("a jsx comment");
  });

  // Hole 2: `/*` inside a string, template or regex literal is not a comment.
  //
  // **Each case asserts the LITERAL's body survived**, not merely that the
  // `KEEP` after it did. Checking the trailing marker only proves the stripper
  // did not eat the rest of the file; it says nothing about whether it blanked
  // the literal itself, which is precisely the defect — a swept file whose
  // string contents vanished would pass an absence test for the wrong reason.
  // CodeRabbit, PR #174.
  it("leaves a comment opener inside a literal alone", () => {
    const inString = stripComments('const s = "/* not a comment */"; const KEEP = 1;');
    expect(inString).toContain("KEEP");
    expect(inString).toContain("/* not a comment */");

    const inTemplate = stripComments("const t = `/* nor this */`; const KEEP = 2;");
    expect(inTemplate).toContain("KEEP");
    expect(inTemplate).toContain("/* nor this */");

    const inSubstitution = stripComments("const t = `a ${`/* deep */`} b`; const KEEP = 4;");
    expect(inSubstitution).toContain("KEEP");
    expect(inSubstitution).toContain("/* deep */");

    const inRegex = stripComments("const r = /\\/\\*keepme/; const KEEP = 3;");
    expect(inRegex).toContain("KEEP");
    expect(inRegex).toContain("keepme");
  });

  // Keeps line numbers stable, so a sweep that reports a line is reporting the
  // real one.
  it("preserves line count", () => {
    const source = "const a = 1;\n/* one\n two\n three */\nconst b = 2;";
    expect(stripComments(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  // Two identifiers separated only by a comment must not fuse.
  it("does not weld tokens together", () => {
    expect(stripComments("const/* x */KEEP = 1;")).toMatch(/const\s+KEEP/);
  });
});
