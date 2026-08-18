// Local copy of straight-line (great-circle) distance. Deliberately NOT
// imported from packages/domain (packages/domain/src/trip/conflicts.ts's
// haversineKm) — the UI layer must never import @tc/domain (AGENTS.md
// architecture boundary, CI-enforced). A ~10-line haversine is generic
// public math, not domain logic, so a second small copy here is the
// sanctioned way to derive an honest straight-line distance for a leg
// without crossing that boundary.
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
