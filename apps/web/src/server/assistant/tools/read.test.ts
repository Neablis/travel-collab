import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { readDayTool, readTrip, searchPlaybooksTool } from "./read";

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

// Travellers spec §5 (invariant 7): a total prices a stop nobody picked for the
// travellers, so the model is told how many that is — or it would divide the
// total by every member and hand an adviser a share of the hotel.
describe("read_trip says who the totals are for", () => {
  it("reports the travellers alongside the members", () => {
    const trip = tripDetailFactory.build({
      members: [
        { userId: "u1", role: "owner" },
        { userId: "u2", role: "editor" },
        { userId: "u3", role: "suggester", travelling: false },
      ],
    });
    expect(readTrip(trip)).toMatchObject({ members: 3, travellers: 2 });
  });

  it("read_day says a stop nobody picked is priced for the travellers", () => {
    expect(readDayTool.description).toMatch(/travellers/);
  });
});
