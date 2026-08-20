# Design: full desktop shadcn compliance

## Boundaries

- `packages/ui` owns shadcn-derived primitives, exports, theme tokens, and reusable semantic compositions.
- `apps/desktop/src/renderer` owns product page composition and may add application-specific components only when no installed/registry shadcn primitive expresses the behavior.
- Main, preload, Rust, and protocol layers are behavior-preservation boundaries and are not changed for cosmetic compliance.

## Audit model

Maintain a rule-by-rule inventory rather than treating a successful typecheck as proof. Mechanical rules are enforced by a focused source test. Structural and behavioral rules are covered by renderer tests and Electron walkthroughs.

The audit categories are:

1. Base project configuration and primitive provenance.
2. Styling and semantic tokens.
3. Forms and validation semantics.
4. Component composition and grouping.
5. Overlays and accessible titles.
6. Icons and control affordances.
7. Empty/loading/status/card semantics.
8. Chat and activity-thread behavior.
9. macOS window, focus, keyboard, and compact-size behavior.

## Implementation strategy

1. Fix or add shared primitives first, using `shadcn add --dry-run` / `--diff` and current Base UI docs.
2. Add a mechanical compliance test before broad rewrites so the remaining inventory is measurable.
3. Migrate pages by semantic cluster: shell/navigation; create/edit/settings forms; catalog/task overlays; status/empty displays; chat/activity.
4. Keep business calls and state ownership unchanged. Component migrations wrap existing callbacks rather than moving authority into UI primitives.
5. For generated upstream primitives, preserve registry-required internal stacking and dark-state classes. The application-level audit excludes those documented upstream implementation details.

## Compatibility and rollback

- Preserve component public exports while adding primitives.
- Make page migrations independently reversible by file.
- Do not use `shadcn --overwrite`; merge upstream changes manually after diff review.
- If a registry chat primitive cannot support a currently verified behavior, keep the existing behavior temporarily, record the mismatch, and do not claim that category complete until equivalent behavior is proven.

## Verification

- Source compliance test for mechanical rules and structural AST/text invariants.
- Existing page tests plus new regression tests for migrated forms, overlays, menus, and message scrolling.
- `@coordy/ui` TypeScript compile, desktop typecheck, renderer/full test suites, production build.
- Real Electron screenshots and interaction checks at representative widths.
