import { PlaybooksScreen } from "@/components/playbooks/PlaybooksScreen";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";
import { Preview } from "@/components/ui/preview";

// The `/playbooks` route (README §3): reachable for real from the home
// page's "Start from a Playbook" link (app/page.tsx head), but its content
// is entirely inert — the whole screen mounts inside
// <Preview id="playbooks-route"> (Task 3's seam), same pattern as home's
// "home-playbooks-strip"/"home-worth-attention" shells (Task 16).
export default function PlaybooksPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Preview id="playbooks-route" size="container">
        <PlaybooksScreen playbooks={PREVIEW_PLAYBOOK_CARDS} />
      </Preview>
    </main>
  );
}
