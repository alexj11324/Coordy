# Implementation plan

1. Record shadcn project info, installed primitive inventory, and rule-by-rule baseline counts.
2. Inspect current registry docs/diffs for every primitive to add or materially modify.
3. Add a focused compliance test covering mechanical Critical Rules, with explicit exclusions limited to upstream generated primitives.
4. Repair shared UI exports/compositions and remove application-owned primitive reinventions.
5. Migrate shell, navigation, menu, and overlay composition.
6. Migrate forms and option sets to Field/FieldGroup/FieldSet and proper Base Select grouping.
7. Migrate empty, loading, status, Badge, Separator, and Card patterns.
8. Install and compose chat primitives; migrate floating chat and task activity without losing scrolling or anchoring behavior.
9. Remove remaining styling/icon violations and run the complete source audit.
10. Run focused and full tests, both typechecks, production build, and real Electron walkthroughs at normal and compact sizes.
11. Run Trellis quality check, update the UI code-spec with enforceable conventions, and commit only the verified concern when the dirty worktree permits safe isolation.

## Validation commands

- `pnpm --filter @coordy/ui exec tsc --noEmit -p tsconfig.json`
- `pnpm --filter @coordy/desktop typecheck`
- `pnpm --filter @coordy/desktop test`
- `pnpm --filter @coordy/desktop build`
- focused source compliance test introduced by this task
- `git diff --check`

## Risk points

- Existing renderer files contain concurrent changes from other active tasks; inspect each diff before editing and never reset or overwrite those changes.
- Overlay and chat rewrites can alter focus, keyboard handling, scrolling, and macOS drag regions; runtime verification is mandatory.
- Registry primitives may have generated internal classes that look like application rule violations; exclusions must point to registry provenance rather than hiding arbitrary paths.
