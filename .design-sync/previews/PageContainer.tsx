import { PageContainer } from "web";

export function Default() {
  return (
    <div style={{ background: "#f7f8f6", width: 500, padding: 8 }}>
      <PageContainer width="content" style={{ background: "#eff2ed", padding: 8 }}>
        <div style={{ fontSize: 13, color: "#5a6472" }}>Content-width container (max-w-content) — the default page + non-full lenses.</div>
      </PageContainer>
    </div>
  );
}

export function Measure() {
  return (
    <div style={{ background: "#f7f8f6", width: 500, padding: 8 }}>
      <PageContainer width="measure" style={{ background: "#eff2ed", padding: 8 }}>
        <div style={{ fontSize: 13, color: "#5a6472" }}>Measure-width container (max-w-measure) — forms, settings sheet, prose.</div>
      </PageContainer>
    </div>
  );
}
