# Design

## Boundaries

- Treat `assets/coordy-pixel-icon.svg` as the canonical repository brand mark because both READMEs already consume that path.
- Keep the SVG deterministic and editable: seven `<rect>` elements, one fill group, transparent canvas.
- Treat `.trellis/workflow.md` as the authoritative workflow source. Synchronize platform-facing local skills and Codex fallback text that independently state the old approval rule.

## Workflow behavior

No active task follows this decision:

1. If the request is a one-reply answer with no repository mutation or research, answer directly.
2. If the request needs files changed, research, or multi-step verification, create a task and plan autonomously.
3. If the user already asked to implement and planning exposes no unresolved user-owned decision, activate and execute without a separate process-approval prompt.
4. If a genuine product/scope/risk choice remains, ask exactly that decision rather than asking for workflow consent.

## Commit behavior

1. Derive candidate commit files from the active task artifacts and observed task edits, then review the full diff for each candidate.
2. Exclude `.trellis/tasks/` and `.trellis/workspace/` before ownership classification because archive and journal scripts auto-commit those bookkeeping paths later.
3. Commit autonomously only after the task's relevant verification passes and both the staged file list and staged diff contain exclusively task-owned changes.
4. Leave every unrecognized dirty file unstaged without asking the user to classify it.
5. If a file mixes task-owned and unrelated edits, isolate only clearly attributable hunks when safe. Ask the user only when that overlap cannot be separated into a safe focused commit.
6. Do not amend or push as part of Phase 3.4.

## Compatibility and rollback

- Keeping the existing icon filename avoids README churn and broken links.
- The workflow customization is project-local. A future `trellis update` may surface conflicts for modified managed files; the local content remains the intended policy.
- Rollback is file-local: restore the previous SVG and the prior workflow/skill wording without touching unrelated changes.
