<!-- VERSION: 1.2.0 | DATE: 2026-03-04 | SOURCE: SKILL.md (skills/user-experience/SKILL.md) Sections "MCP Integration Architecture" (#mcp-integration-architecture), "Current Jerry MCP Integration" (#current-jerry-mcp-integration), "Figma Dependency Risk Profile" (#figma-dependency-risk-profile), "Cost Tiers" (#cost-tiers), "Lifecycle-Stage Routing" (#lifecycle-stage-routing) | PARENT: /user-experience skill | GOVERNANCE: .context/rules/mcp-tool-standards.md (MCP-001, MCP-002) | PROJECT: projects/PROJ-022-user-experience-skill/PLAN.md -->

# MCP Coordination Rules

> MCP tool coordination rules for the /user-experience skill. Defines the sub-skill MCP dependency matrix, degraded mode behavior, Context7 integration, cost tiers, and future MCP adapter architecture. See also: `skills/user-experience/rules/ux-routing-rules.md` (MCP CHECK step in lifecycle triage), `skills/user-experience/rules/wave-progression.md` (wave deployment readiness affected by MCP availability), `skills/user-experience/rules/ci-checks.md` (CI gate UX-CI-007 validates kickoff signoff file structure including MCP-related fields per [Wave Gate Compliance](../rules/ci-checks.md#wave-gate-compliance)). MCP governance: `.context/rules/mcp-tool-standards.md` [Context7 Integration](#context7-integration), [Memory-Keeper Integration](#memory-keeper-integration) -- MCP-001 (Context7 MUST for external library references), MCP-002 (Memory-Keeper MUST at phase boundaries).

## Document Sections

| Section | Purpose |
|---------|---------|
| [MCP Dependency Matrix](#mcp-dependency-matrix) | Which sub-skills require which MCP servers |
| [Dependency Classifications](#dependency-classifications) | REQ/ENH/COND definitions and enforcement |
| [Degraded Mode Behavior](#degraded-mode-behavior) | Fallback paths when MCP is unavailable |
| [Figma Dependency Risk Profile](#figma-dependency-risk-profile) | Highest-risk MCP dependency with per-sub-skill fallbacks |
| [Context7 Usage](#context7-usage) | When to use Context7 for UX framework docs |
| [Cost Tiers](#cost-tiers) | MCP cost categories for team planning |
| [MCP Availability Detection](#mcp-availability-detection) | How the orchestrator probes MCP status |
| [Future MCP Adapters](#future-mcp-adapters) | Architecture for Figma/Miro/Storybook adapters |

---

## MCP Dependency Matrix

<!-- Source: SKILL.md [MCP Integration Architecture](../SKILL.md#mcp-integration-architecture) — sub-skill dependency matrix (SKILL.md lines 400-411). Note: `/ux-ai-first-design` has Figma **REQ** dependency (SKILL.md line 411). The sub-skill itself is conditionally deployed (Wave 5 COND entry criteria: Enabler DONE + WSM >= 7.80, per SKILL.md [Wave Architecture](../SKILL.md#wave-architecture) line 267), but when invoked, Figma is a required dependency — wave deployment conditionality and MCP dependency classification are independent dimensions. -->

> **Scope:** This matrix covers design-tool MCP dependencies (Figma, Miro, Storybook, Zeroheight, Hotjar Bridge, Whimsical). Infrastructure MCP tools -- specifically Memory-Keeper (`mcp__memory-keeper__context_save`, `mcp__memory-keeper__context_get`, `mcp__memory-keeper__context_search`) used by `ux-orchestrator` for phase-boundary state per MCP-002 (`.context/rules/mcp-tool-standards.md` [Memory-Keeper Integration](#memory-keeper-integration)) -- are governed by `mcp-tool-standards.md` and are not included in this matrix. No sub-skill agent requires Memory-Keeper; all sub-skill state is engagement-scoped per P-002.

| Sub-Skill | Figma | Miro | Storybook | Zeroheight | Hotjar (Bridge) | Whimsical |
|-----------|-------|------|-----------|------------|-----------------|-----------|
| `/ux-heuristic-eval` | **REQ** | -- | ENH | -- | -- | -- |
| `/ux-jtbd` | -- | ENH | -- | -- | -- | -- |
| `/ux-lean-ux` | ENH | **REQ** | -- | -- | ENH | -- |
| `/ux-heart-metrics` | -- | -- | -- | -- | ENH | -- |
| `/ux-atomic-design` | ENH | -- | **REQ** | ENH | -- | -- |
| `/ux-inclusive-design` | **REQ** | -- | ENH | -- | -- | -- |
| `/ux-behavior-design` | -- | ENH | -- | -- | ENH | -- |
| `/ux-kano-model` | -- | ENH | -- | -- | -- | -- |
| `/ux-design-sprint` | **REQ** | **REQ** | -- | -- | -- | ENH |
| `/ux-ai-first-design` | **REQ** | -- | ENH | -- | -- | -- |

---

## Dependency Classifications

<!-- Source: SKILL.md [MCP Integration Architecture](../SKILL.md#mcp-integration-architecture) — dependency classification definitions (SKILL.md line 413). REQ/ENH/COND labels used consistently across the dependency matrix and degraded-mode tables. Note: COND classification applies to MCP dependency conditionality (e.g., feature X required only when condition Y is met), NOT to sub-skill wave deployment conditionality (which is tracked in wave-progression.md [Wave Definitions]). -->

| Classification | Label | Meaning | Failure Behavior |
|---------------|-------|---------|-----------------|
| **Required** | REQ | Sub-skill depends on this MCP for core functionality | Degraded mode + explicit error. Sub-skill operates with reduced capability; output carries degraded-mode banner. |
| **Enhancement** | ENH | MCP improves output quality but is not essential | Cosmetic limitation on failure. Sub-skill operates normally; enhanced features silently degrade to text-only equivalents. |
| **Conditional** | COND | MCP required only under specific conditions | Depends on condition. When condition is met and MCP unavailable: treated as REQ. When condition not met: no dependency. |

> **COND instantiation note:** No current sub-skill has a COND MCP dependency in the matrix above. All dependencies are classified as REQ or ENH. The COND classification is defined here for completeness and future adapter use. Example of when COND would apply: if a future MCP adapter (e.g., Hotjar Bridge) were required only when evaluating products with > 1,000 monthly active users (where behavioral analytics data is statistically meaningful), that dependency would be classified COND rather than ENH — the adapter is not merely an enhancement but is required under specific data-volume conditions. The distinction from wave deployment conditionality is important: wave COND (SKILL.md line 267) governs whether a sub-skill is *deployed*; MCP COND governs whether a specific MCP tool is *needed by* an already-deployed sub-skill.

### Enforcement Rules

1. **REQ dependencies:** When a REQ MCP is unavailable, the orchestrator MUST inform the user per P-022 and route to the degraded-mode fallback path. The sub-skill MUST NOT silently proceed as if the MCP were available.
2. **ENH dependencies:** When an ENH MCP is unavailable, the sub-skill proceeds normally. No user notification required unless the user explicitly requested the enhanced feature.
3. **COND dependencies:** The orchestrator evaluates the condition before checking MCP availability. If the condition is not met, the MCP is not needed. If the condition is met and the MCP is unavailable, behavior follows REQ enforcement (degraded mode + explicit error).

---

## Degraded Mode Behavior

<!-- Source: SKILL.md [MCP Integration Architecture](../SKILL.md#mcp-integration-architecture) — text-only mode (SKILL.md lines 441-443); [Fallback: Text-Only Mode](../SKILL.md#fallback-text-only-mode). -->

### Text-Only Mode

When MCP tools are unavailable, all agents operate in **text-only mode**: users provide design descriptions, screenshots, or markup instead of live design artifacts. The agent methodology remains identical; only the input modality changes.

### Currently Exercisable Fallbacks

These degraded modes apply to MCP tools that are available in the current Jerry infrastructure and can be tested now.

| MCP Tool | Canonical Name | Degraded Mode | Impact |
|----------|---------------|--------------|--------|
| Context7 Resolve | `mcp__context7__resolve-library-id` | WebSearch fallback per MCP-001 (`.context/rules/mcp-tool-standards.md` [Error Handling](#error-handling)): use web search for UX framework documentation when resolve-library-id returns no matches | May return less targeted results; stale training data risk |
| Context7 Query | `mcp__context7__query-docs` | WebSearch fallback: use web search and note "Context7 no coverage" in output per `mcp-tool-standards.md` [Error Handling](#error-handling) | Less precise documentation lookup; may retrieve outdated API references |

### Future Adapter Fallbacks (Architecture Only)

These degraded modes apply to future MCP adapters that are not yet implemented. **Actual adapter implementation is out of scope for PROJ-022** (see `projects/PROJ-022-user-experience-skill/PLAN.md`). The fallback paths are defined here to enable sub-skill operation in text-only mode until adapters are built.

| MCP Tool | Degraded Mode | Impact |
|----------|--------------|--------|
| Figma | Screenshot-input mode: user provides design screenshots as image inputs | Cannot inspect layers, components, or style tokens programmatically |
| Miro | Text-based exercise mode: sprint/workshop exercises described textually | Cannot create or modify collaborative boards |
| Storybook | Manual component inventory: user provides component list and documentation links | Cannot browse or validate live component stories |
| Zeroheight | Text-based design system reference: user provides design token documentation | Cannot query design system programmatically |
| Hotjar (Bridge) | Manual analytics input: user provides behavioral data via text description | Cannot access heatmaps or session recordings directly |
| Whimsical | Text-based flowcharts: user provides flow descriptions or ASCII diagrams | Cannot create visual diagrams |

### Degraded Mode Disclosure

Per P-022, agents MUST note degraded mode in their output:

```
[DEGRADED MODE] This output was produced without {MCP tool name} access.
Input was provided via {fallback method}. Some features are reduced:
- {specific limitation 1}
- {specific limitation 2}
```

---

## Figma Dependency Risk Profile

<!-- Source: SKILL.md [Figma Dependency Risk Profile](../SKILL.md#figma-dependency-risk-profile) (SKILL.md lines 415-424). Non-Figma Fallback column sourced from SKILL.md; Quality Impact column is an elaboration added by this rule file for operational guidance. -->

Figma is the highest-risk MCP dependency: 4 sub-skills require it (REQ), 2 are enhanced by it (ENH), totaling 6 of 10 sub-skill connections. REQ count verified against MCP Dependency Matrix: `/ux-heuristic-eval`, `/ux-inclusive-design`, `/ux-design-sprint`, `/ux-ai-first-design`. ENH count: `/ux-lean-ux`, `/ux-atomic-design`.

| Sub-Skill | Non-Figma Fallback | Quality Impact |
|-----------|--------------------|---------------|
| `/ux-heuristic-eval` | Screenshot-input mode: user provides design screenshots as image inputs | Moderate: cannot inspect component states or responsive behavior |
| `/ux-design-sprint` | Miro-only mode: sprint exercises in Miro; manual prototype reference | Significant: prototyping and concept evaluation rely on visual artifacts |
| `/ux-inclusive-design` | Screenshot-input mode: manual component screenshots for evaluation | Moderate: cannot inspect color values or contrast ratios programmatically |
| `/ux-ai-first-design` | Manual design description: text-based interaction pattern analysis | Significant: AI interaction patterns benefit from visual prototyping |

### Figma Mitigation Strategy

1. **Wave 1 sub-skills do not require Figma:** `/ux-heuristic-eval` (REQ Figma) is Wave 1, but screenshot-input mode provides viable fallback.
2. **Figma MCP adapter is architecture-only in PROJ-022:** Actual adapter implementation deferred to post-PROJ-022 (see `projects/PROJ-022-user-experience-skill/PLAN.md`). Architecture + fallback paths defined here.
3. **Cost tier awareness:** Free tier ($0) runs Figma-dependent sub-skills in degraded mode (screenshot-input fallback), not at full capability. Sub-skills are not blocked entirely; they operate with reduced input modality per the degraded mode behavior defined in [Currently Exercisable Fallbacks](#currently-exercisable-fallbacks) and [Future Adapter Fallbacks](#future-adapter-fallbacks-architecture-only).

---

## Context7 Usage

<!-- Source: SKILL.md [Current Jerry MCP Integration](../SKILL.md#current-jerry-mcp-integration) (SKILL.md lines 434-439) and `.context/rules/mcp-tool-standards.md` MCP-001 ([Context7 Integration](#context7-integration)). Canonical tool names sourced from `mcp-tool-standards.md` [Canonical Tool Names](#canonical-tool-names). -->

### Currently Available MCP Integration

Per MCP-001 (`.context/rules/mcp-tool-standards.md` [Context7 Integration](#context7-integration)): "Context7 MUST be used when any agent task references an external library, framework, SDK, or API by name. Respect the per-question call limit enforced by the tool. WebSearch is permitted only for general concepts or when Context7 returns no results." Source: FEAT-028 AC-1.

| MCP Tool | Canonical Name | Usage | Agents |
|----------|---------------|-------|--------|
| Context7 Resolve | `mcp__context7__resolve-library-id` | Resolve UX framework libraries and design system packages | ux-heuristic-evaluator, ux-atomic-architect, ux-ai-design-guide |
| Context7 Query | `mcp__context7__query-docs` | Query component library documentation, accessibility API docs, heuristic evaluation UX framework research | ux-heuristic-evaluator, ux-atomic-architect, ux-inclusive-evaluator, ux-ai-design-guide |

### Context7 Usage Rules

Per MCP-001 (`.context/rules/mcp-tool-standards.md` [Context7 Integration](#context7-integration)):

1. Context7 MUST be used when an agent task references an external UX library, framework, or design system by name (e.g., Material UI, Radix, WCAG specification).
2. Protocol: call `mcp__context7__resolve-library-id` with library name first, then call `mcp__context7__query-docs` with resolved library ID and specific query.
3. Respect the per-question call limit enforced by the tool; each distinct library resets the limit.
4. If `mcp__context7__resolve-library-id` returns no matches: fall back to WebSearch for that library per `mcp-tool-standards.md` [Error Handling](#error-handling).

### Context7 UX Framework Examples

| Library/Framework | Expected Agent | Usage |
|-------------------|---------------|-------|
| WCAG 2.2 | ux-inclusive-evaluator | Accessibility success criteria lookup |
| Material Design | ux-atomic-architect | Component pattern documentation |
| Radix UI | ux-atomic-architect | Accessible component API docs |
| Nielsen Norman Group | ux-heuristic-evaluator | Heuristic definitions and severity scales |
| Fogg Behavior Model | ux-behavior-diagnostician | B=MAP framework documentation |

---

## Cost Tiers

<!-- Source: SKILL.md [Cost Tiers](../SKILL.md#cost-tiers) (SKILL.md lines 426-432). -->

| Tier | Monthly Cost | Sub-Skills Available |
|------|-------------|---------------------|
| **Free** | $0 | HEART, JTBD, Kano, Behavior Design (+ Storybook for Atomic Design) |
| **Minimal** | ~$46 | + Heuristic Eval, Design Sprint, Lean UX, Inclusive Design, AI-First Design |
| **Full Enhancement** | ~$145-245 | All 10 with full enhancement MCPs |

### Cost Tier Routing

The orchestrator's CAPACITY CHECK step (see `ux-routing-rules.md` [Lifecycle Stage Router]) considers cost tier implications. When team UX capacity is < 20% of one person's time, the orchestrator recommends Wave 1 sub-skills only, which align with the Free cost tier. The user decides whether to accept this recommendation (P-020).

---

## MCP Availability Detection

<!-- Source: SKILL.md [Lifecycle-Stage Routing](../SKILL.md#lifecycle-stage-routing) — MCP CHECK step (SKILL.md line 303). Probe implementation details (WCAG test call, caching, timeout handling, retry policy) are elaborations operationalizing the SKILL.md specification; the SKILL.md defines the MCP CHECK step conceptually and this section provides the concrete implementation protocol. -->

The orchestrator's 4-step lifecycle triage includes MCP detection at Step 3:

### Detection Protocol

1. **Probe:** Attempt a lightweight `mcp__context7__resolve-library-id` call (e.g., resolve "WCAG"). **Timeout definition:** a timeout is defined as > 5 seconds with no response from the MCP server. One retry is attempted after a timeout before declaring the MCP unavailable.
2. **If success:** MCP available. Cache status for the duration of the engagement session (no re-probing within the same engagement).
3. **If failure:** MCP unavailable. Failure conditions: (a) timeout exceeding 5 seconds after 1 retry, (b) error response from the MCP server, or (c) MCP server unreachable. Route all sub-skills to non-MCP fallback paths defined in [Currently Exercisable Fallbacks](#currently-exercisable-fallbacks) and [Future Adapter Fallbacks](#future-adapter-fallbacks-architecture-only).
4. **Disclose:** Inform user of MCP status per P-022. "MCP tools are [available/unavailable] for this session. [Available features / Degraded mode description]."

### Future MCP Probes

When Figma/Miro/Storybook MCP adapters become available, the detection protocol will expand. Probe implementations for Figma/Miro/Storybook will be specified in their respective adapter architecture documents when implemented (post-PROJ-022 scope, see `projects/PROJ-022-user-experience-skill/PLAN.md`). Each probe endpoint specification follows the Adapter Architecture Pattern step 1 (health probe endpoint) defined in [Future MCP Adapters](#future-mcp-adapters).

| Probe | Target | Fallback |
|-------|--------|----------|
| `mcp__context7__resolve-library-id` | UX library documentation | WebSearch per `mcp-tool-standards.md` [Error Handling](#error-handling) |
| Figma API health (future) | Figma file access | Screenshot-input mode |
| Miro API health (future) | Miro board access | Text-based exercise mode |
| Storybook endpoint (future) | Component story browsing | Manual component inventory |

---

## Future MCP Adapters

<!-- Source: SKILL.md [MCP Integration Architecture](../SKILL.md#mcp-integration-architecture) — architecture + fallback paths only (SKILL.md lines 396-445). Adapter architecture pattern and planned adapter table are elaborations derived from the SKILL.md dependency matrix and text-only mode specification. -->

This section defines the adapter architecture for future MCP integrations. **Actual adapter implementation is out of scope for PROJ-022** (architecture scope: `projects/PROJ-022-user-experience-skill/PLAN.md`; adapter implementation deferred to post-PROJ-022).

### Adapter Architecture Pattern

Each future MCP adapter follows the same pattern:

```
MCP Adapter Pattern:
1. Health probe endpoint → availability detection
2. Authentication flow → OAuth2 or API key
3. Read-only operations → artifact inspection, data retrieval
4. Write operations (optional) → artifact creation/modification
5. Fallback path → text-only mode per Degraded Mode Behavior
```

### Planned Adapters

| Adapter | Priority | Rationale | Authentication |
|---------|----------|-----------|---------------|
| Figma MCP | HIGH | 6/10 sub-skill connections; highest-risk dependency | OAuth2 (Figma API) |
| Miro MCP | MEDIUM | 2 REQ + 2 ENH connections; Design Sprint critical path | OAuth2 (Miro API) |
| Storybook MCP | MEDIUM | 1 REQ + 3 ENH connections; Atomic Design core workflow | Local endpoint (dev server) |
| Hotjar Bridge | LOW | 2 ENH connections; analytics enrichment only | API key |
| Zeroheight MCP | LOW | 1 ENH connection; design system documentation | API key |
| Whimsical MCP | LOW | 1 ENH connection; diagram enhancement only | OAuth2 |

### Security Considerations

Per `/eng-team` integration (see SKILL.md [Cross-Skill Integration](../SKILL.md#cross-skill-integration)):

- MCP credential handling follows Jerry's MCP tool standards (`.context/rules/mcp-tool-standards.md`).
- OAuth tokens for Figma/Miro MUST NOT be stored in agent context or output files.
- API keys MUST be managed via environment variables or secrets management (see `.claude/settings.local.json` for runtime MCP server configuration per `mcp-tool-standards.md` [References](#references)).
- Adapter health probes MUST NOT expose authentication state in error messages.

---

*Rule file: mcp-coordination.md (v1.2.0)*
*Parent skill: /user-experience*
*Parent SKILL.md: `skills/user-experience/SKILL.md`*
*MCP governance SSOT: `.context/rules/mcp-tool-standards.md` (MCP-001, MCP-002)*
*Canonical tool names: `mcp-tool-standards.md` [Canonical Tool Names](#canonical-tool-names)*
*Project scope: `projects/PROJ-022-user-experience-skill/PLAN.md`*
*Sibling rules: `skills/user-experience/rules/ux-routing-rules.md`, `skills/user-experience/rules/synthesis-validation.md`, `skills/user-experience/rules/wave-progression.md`, `skills/user-experience/rules/ci-checks.md`*
*Created: 2026-03-03*
*Updated: 2026-03-04*
*Revision: iter4 — added ux-heuristic-evaluator to Context7 agent table (Wave 1 deployment); prior: iter3 addressed Internal Consistency (REQ/COND clarification, degraded mode separation), Completeness (Memory-Keeper scope note, COND instantiation), Traceability (anchor links, PROJ-022 path, MCP-001 citations), Methodological Rigor (timeout definition, failure conditions), Evidence Quality (canonical tool names, source annotation precision)*
*Status: COMPLETE*
