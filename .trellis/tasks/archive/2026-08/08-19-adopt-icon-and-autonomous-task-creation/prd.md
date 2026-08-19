# Adopt Open Core icon and autonomous Trellis task creation

## Goal

Make the user-approved pure-black Open Core SVG the canonical Coordy brand mark, and make the local Trellis workflow autonomously create, execute, and safely commit a task without asking for process consent.

## Background

- The approved icon is the seven-square, pure-black, transparent-background “Open Core” mark.
- The repository currently exposes `assets/coordy-pixel-icon.svg` in both READMEs; no packaged desktop icon asset is currently configured.
- The local Trellis workflow, start/brainstorm skills, and Codex session fallback text currently require task-creation consent and a later implementation-approval prompt.
- Phase 3.4 separately requires one-shot confirmation before committing even when task ownership and verification are already clear.
- The user explicitly requested that these process approval prompts be removed and that the agent plan and create tasks autonomously.

## Requirements

1. Replace the contents of the existing canonical `assets/coordy-pixel-icon.svg` with the approved Open Core geometry.
2. Preserve a transparent background and pure `#000000` fill. Do not add gradients, shadows, rounded containers, or extra colors.
3. Keep existing README references working through the existing canonical asset path.
4. Do not invent a packaged macOS/Windows/Linux app icon pipeline in this task; the repository currently has no such source asset/configuration, and the approved artifact is a brand-mark SVG rather than a platform container treatment.
5. Change the project-local Trellis flow so that:
   - one-reply conversation with no file change or research can skip task creation;
   - substantive changes, research, or multi-step validation cause the agent to create and plan a task autonomously;
   - an explicit implementation request authorizes activation and execution after planning when no unresolved user-owned decision remains;
   - the agent asks only for genuine product, scope, compatibility, or risk decisions that repository evidence cannot resolve.
6. Synchronize the authoritative workflow, the shared start/brainstorm skills, and Codex session fallback wording so they no longer reintroduce the removed approval prompts.
7. Preserve all unrelated dirty-worktree changes and do not stage or commit `.local-specs/`.
8. Change Phase 3.4 so that the agent autonomously commits only task-owned files whose relevant checks have passed, always excludes unrecognized dirty files and Trellis bookkeeping paths (`.trellis/tasks/`, `.trellis/workspace/`), and asks the user only when overlapping ownership makes a safe focused commit impossible.

## Acceptance Criteria

- `assets/coordy-pixel-icon.svg` contains exactly seven equal black square modules at the approved positions, has a `512 × 512` viewBox, and has no background element.
- `README.md` and `README.zh-CN.md` still resolve the canonical icon path.
- A repository search finds no active Trellis instruction telling the agent to ask for task-creation consent or implementation approval for an already explicit implementation request.
- The no-task injected breadcrumb instructs autonomous classification and task creation.
- Planning instructions retain evidence-first clarification for real user-owned decisions.
- SVG parsing/rasterization succeeds and a 24 px preview preserves the block silhouette.
- Focused workflow/context checks pass.
- Phase 3.4 contains no routine commit-confirmation prompt and requires explicit staged-file and staged-diff verification before each autonomous commit.
- Work commits exclude `.trellis/tasks/` and `.trellis/workspace/`; archive and journal automation retain ownership of those paths.
- Unrecognized dirty files are never staged; genuinely inseparable task/unrelated edits trigger an ownership question instead of a commit.
- Only files owned by this task are staged and committed; unrelated pre-existing changes remain untouched.

## Out of Scope

- Designing a colored, dark-mode, tinted, Icon Composer, `.icns`, `.ico`, or store-listing variant.
- Replacing provider/runtime logos.
- Modifying Trellis upstream npm packages or global installations.
- Changing unrelated product UI or runtime behavior.
