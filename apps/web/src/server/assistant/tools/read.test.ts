import { describe, expect, it } from "vitest";
import { readDayTool, searchPlaybooksTool } from "./read";

// ADR-060: a price is for one person. The read tools hand the model money, so
// they say so too — a "total cost" read as a group total would be priced
// again by however many people the model thinks are going.
describe("read tools describe money per person", () => {
  it.each([
    ["read_day", readDayTool.description],
    ["search_playbooks", searchPlaybooksTool.description],
  ])("%s says its cost is for one person", (_name, description) => {
    expect(description).toMatch(/for one person/);
  });
});
