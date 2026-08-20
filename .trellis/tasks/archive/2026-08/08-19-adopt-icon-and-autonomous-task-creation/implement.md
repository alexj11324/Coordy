# Implementation plan

1. Replace the canonical SVG contents with the approved seven-square Open Core mark.
2. Update `.trellis/workflow.md` to remove task-creation and redundant implementation approval gates while preserving evidence-first questions for genuine ambiguity.
3. Synchronize `.agents/skills/trellis-start/SKILL.md`, `.agents/skills/trellis-brainstorm/SKILL.md`, and `.codex/hooks/session-start.py` fallback language.
4. Search all local Trellis/Codex entry points for stale active approval instructions and update only behavior-bearing occurrences.
5. Validate SVG structure, render at 1024 px and 24 px, and visually inspect the result.
6. Run focused Trellis context injection/regression checks available in the repository.
7. Remove the routine Phase 3.4 commit-confirmation gate and synchronize active mirrored commit instructions.
8. Verify that the workflow excludes Trellis bookkeeping paths before ownership classification, stages and commits only task-owned checked changes, leaves unrecognized dirty files unstaged, and asks only about inseparable ownership overlap.
9. Review the exact diff and leave staging/commit execution to the main session.
