# Agent guidelines — index

These guides tell future agents *how* to work in this repo. `AGENTS.md` is the
binding law (invariants, module map, definition of done); these expand it into
practice. Read the one that matches your task:

| Guide | Answers |
|---|---|
| `stack-and-constraints.md` | What framework/stack are we on, and what limits bind every decision? |
| `building-the-parts.md` | How do I build each layer/module — domain, contracts, server, UI? |
| `connecting-the-parts.md` | How do parts talk to each other, and how do interfaces change safely? |
| `validating-direction.md` | How do we know we're still building the *right* thing, and when do we stop and ask Mitchell? |
| `quality-enforcement.md` | What testing/CI/review bar must every change clear? |
| `ci-cost-and-capacity.md` | What does CI cost, what is the minute budget, and why is the workflow shaped the way it is? |
| `design-system.md` | What tokens, colors, and shared components does UI code use — and when? |
| `cloud-agent-sessions.md` | I'm in a Claude Code cloud session — what's different here, and which failures are the container's fault? |
| `fixtures-and-seed-data.md` | I added a feature — where does its sample data go so the demo trip, the preview branch and the tests keep exercising it? |

Document map for orientation:

- **What we're building:** `docs/specs/2026-07-07-foundation-design.md`
- **Why it's shaped this way:** `docs/architecture/ADR-*.md`
- **What order:** `TODO.md` → `docs/milestones/`
- **The law:** `AGENTS.md`
- **How:** this directory
