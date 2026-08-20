# Audit and align desktop UI with shadcn

## Goal

Bring the entire Coordy desktop renderer and shared UI package into observable compliance with the repository's `shadcn` skill while preserving the current Apple desktop product flows and visual identity.

## Background

- The shadcn project is a `base-nova`, Base UI, Tailwind v4, Lucide monorepo workspace rooted at `packages/ui`.
- The audit surface is all production TSX under `apps/desktop/src/renderer/src` plus shared components and theme code under `packages/ui/src`.
- The initial scan found concrete violations across layout spacing, forms, grouped items, overlays, semantic status treatment, empty states, icon composition, and hand-built chat scrolling.
- Existing working-tree changes belong to multiple active tasks. This task must preserve unrelated behavior and must not overwrite locally modified shadcn primitives wholesale.

## Requirements

- Evaluate every production renderer surface and shared UI primitive against all Critical Rules in `.agents/skills/shadcn/SKILL.md` and its `styling`, `forms`, `composition`, `icons`, `base-vs-radix`, and `chat` references.
- Use the installed shadcn components before creating custom UI. Query current Base UI documentation before introducing or materially changing a component.
- Replace hand-built overlays with the correct Dialog, AlertDialog, Sheet, Popover, or DropdownMenu composition, including accessible titles and Base UI `render` triggers.
- Convert forms to `FieldGroup` / `Field` / `FieldLabel`, use fieldset semantics for related choices, and expose invalid/disabled state through the prescribed data and ARIA attributes.
- Put Select, DropdownMenu, Command, Tabs, and related items inside their required Group/List containers.
- Replace `space-x-*` / `space-y-*`, equal width-height pairs, manual truncation, raw state colors, manual dark overrides, and manual overlay z-index with the skill-prescribed layout and semantic patterns.
- Replace hand-built callouts, empty states, badges, separators, skeletons, cards, and loading buttons with installed shadcn compositions where the semantic component applies.
- Apply Lucide icon rules: component icons inherit sizing; icons in text buttons use `data-icon`; icon-only controls retain accessible names.
- Replace hand-built conversation scrolling, message rows, bubbles, attachments, and markers with shadcn chat primitives where those behaviors exist in Coordy's chat/task activity surfaces.
- Preserve current routing, kernel commands, saved state, keyboard behavior, window dragging regions, and native desktop lifecycle behavior.
- Add automated compliance checks for mechanically enforceable rules so future changes cannot silently reintroduce the same violations.

## Acceptance Criteria

- [ ] Every production renderer/shared-UI TSX file is inventoried against each Critical Rule, with each finding either fixed or documented as an upstream primitive exception with evidence.
- [ ] Static compliance checks report no application-owned `space-x-*` / `space-y-*`, raw status colors/manual dark colors, manual overlay z-index, ungrouped Select/DropdownMenu items, or icon sizing inside shadcn controls.
- [ ] All application forms use Field composition and expose label, invalid, and disabled semantics correctly.
- [ ] All Dialog/Sheet/Drawer-style overlays have accessible titles and use Base UI composition; no application-owned fixed backdrop/modal implementation remains.
- [ ] Empty, alert, badge, separator, skeleton, card, and loading states use the installed semantic components where applicable.
- [ ] Chat and task activity threads use the prescribed shadcn messaging primitives and retain follow/anchor/jump-to-latest behavior.
- [ ] UI package typecheck, desktop typecheck, affected renderer tests, full desktop tests where environment permits, and production build pass.
- [ ] Real Electron walkthrough covers navigation, create/edit forms, dialogs/menus, task/chat scrolling, settings, graph, Harness, and empty/error/loading states at normal and compact window sizes without functional or visual regression.
- [ ] `git diff --check` passes and task changes are separable from unrelated active work or explicitly reported when that is impossible.

## Out of Scope

- Redesigning Coordy's product information architecture or copying Multica source code.
- Changing kernel/protocol business contracts unless a UI compliance fix exposes a reproducible contract defect.
- Replacing upstream shadcn implementation details solely because the generated primitive itself contains internal dark-mode or stacking classes.
- Native AppKit/SwiftUI work; Coordy is Electron and the Apple requirement here is the macOS desktop experience.

## Open Questions

None.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
