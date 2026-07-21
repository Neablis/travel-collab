import { Tabs, TabsList, TabsTrigger, TabsContent } from "web";

export function Default() {
  return (
    <Tabs defaultValue="itinerary" style={{ width: 360 }}>
      <TabsList>
        <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
        <TabsTrigger value="map">Map</TabsTrigger>
        <TabsTrigger value="budget">Budget</TabsTrigger>
      </TabsList>
      <TabsContent value="itinerary" style={{ paddingTop: 12, fontSize: 14, color: "#151d2e" }}>
        Day 3 — Positano to Amalfi, 3 stops planned.
      </TabsContent>
      <TabsContent value="map" style={{ paddingTop: 12, fontSize: 14, color: "#151d2e" }}>
        Map view.
      </TabsContent>
      <TabsContent value="budget" style={{ paddingTop: 12, fontSize: 14, color: "#151d2e" }}>
        Budget view.
      </TabsContent>
    </Tabs>
  );
}
