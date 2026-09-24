### KI-2026-09-24-l — opening a trip on a phone lands on Overview while the tab bar marks Plan as current

- **Severity:** correctness of navigation state, small — the tab bar lies about where you are.
- **Area:** the phone tab bar (`aria-current="page"` logic) and the trip's default view on a phone; SPEC §10.
- **Symptom / What happens:** measured 2026-09-24 at 390px: a trip opens on the Overview document, but the tab bar marks **Plan** `aria-current=page`. The Overview itself is the desktop notebook document inside a padded card (8,560px tall), which reads but is not the designed phone companion.
- **Why not fixed here:** needs the phone's default view confirmed (Overview or Plan) before choosing which half to change.
- **Cross-reference:** screenshot `d-overview-mid-390.png` from the 2026-09-24 check; KI-2026-09-24-i.
- **First noted:** 2026-09-24, mobile check.
