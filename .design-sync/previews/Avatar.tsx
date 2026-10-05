import { Avatar } from "web";

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar name="Sam Kim" initials="SK" size="sm" />
      <Avatar name="Sam Kim" initials="SK" size="md" />
      <Avatar name="Sam Kim" initials="SK" size="lg" />
    </div>
  );
}

export function Tones() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar name="Jo Lee" initials="JL" size="lg" />
      <Avatar name="Dana Reyes" initials="DR" size="lg" tone="info" />
    </div>
  );
}

export function PendingInvite() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Avatar
        name="priya@example.com"
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        }
      />
      <span style={{ fontSize: 14, color: "#151d2e" }}>priya@example.com</span>
    </div>
  );
}
