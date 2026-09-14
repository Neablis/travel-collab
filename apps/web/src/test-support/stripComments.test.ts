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
  it("leaves a comment opener inside a literal alone", () => {
    expect(stripComments('const s = "/* not a comment */"; const KEEP = 1;')).toContain("KEEP");
    expect(stripComments('const s = "/* not a comment */"; const KEEP = 1;')).toContain("not a comment");
    expect(stripComments("const t = `/* nor this */`; const KEEP = 2;")).toContain("KEEP");
    expect(stripComments("const r = /\\/\\*/; const KEEP = 3;")).toContain("KEEP");
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
