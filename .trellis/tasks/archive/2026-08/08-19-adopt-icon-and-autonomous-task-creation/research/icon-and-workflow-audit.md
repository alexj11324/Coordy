# Icon and workflow audit

## Current icon surface

- `assets/coordy-pixel-icon.svg` is the only tracked Coordy brand icon found outside build output.
- `README.md` and `README.zh-CN.md` both reference that exact path.
- `apps/desktop/electron-builder.yml` does not configure a packaged app icon, and the desktop source has no Coordy dock/window icon path.
- Therefore this task replaces the canonical existing brand mark without inventing platform container/export behavior the user has not approved.

## Approval-gate sources

Behavior-bearing old wording exists in:

- `.trellis/workflow.md`: phase summary, request triage, no-task breadcrumb, Phase 1 creation/activation text, guardrails, and customization invariant.
- `.agents/skills/trellis-start/SKILL.md`: no-active-task routing.
- `.agents/skills/trellis-brainstorm/SKILL.md`: precondition and final implementation-approval gate.
- `.codex/hooks/session-start.py`: fallback bootstrap notice when no workflow block is available.

`.codex/hooks/inject-workflow-state.py` contains comments about the no-task breadcrumb but does not hard-code the old consent behavior.

## Commit-confirmation sources

- `.trellis/workflow.md` Phase 3.4 is the behavior-bearing source for the one-shot commit plan confirmation, rejection path, and re-confirmation rule.
- `.agents/skills/trellis-meta/references/local-architecture/workflow.md` mirrors Phase 3.4 as “batched, user-confirmed” and must stay synchronized.
- `.agents/skills/trellis-finish-work/SKILL.md` already routes task-owned dirty files back to Phase 3.4, excludes unrelated parallel work, and asks only when ownership is genuinely unclear; it does not independently require commit confirmation.

## Visual constraints

- Approved geometry: seven equal squares forming an open C around shared central negative space.
- Color: `#000000` only.
- Background: transparent.
- The Apple platform rule requires editable SVG vectors for any future Icon Composer work; the canonical mark satisfies the vector-source boundary but this task does not add platform packaging.
