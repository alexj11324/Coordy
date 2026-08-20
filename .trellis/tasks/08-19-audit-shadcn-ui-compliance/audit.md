# shadcn compliance audit

## Authoritative scope

- 47 production renderer TSX files under `apps/desktop/src/renderer/src` (tests excluded from page count).
- 34 shared UI/custom TSX files under `packages/ui/src` after installing the required official primitives.
- Project: `base-nova`, Base UI, Tailwind v4, Lucide, non-RSC.
- Upstream-generated primitive internals are reviewed for provenance but excluded from application-level bans on internal overlay stacking and generated dark-state selectors.

## Baseline (2026-08-19)

| Rule family | Baseline evidence | State |
| --- | ---: | --- |
| `space-x-*` / `space-y-*` | 51 application occurrences | open |
| raw status colors / manual `dark:` | 14 application occurrences | open |
| application-owned portal/fixed overlay implementations | 4 files | open |
| ungrouped Select/DropdownMenu/Command/Tabs items | 49 AST findings | in progress |
| production `<form>` elements | 21 forms, only 16 Field wrappers in whole renderer | open; structural review required |
| hand-built floating-chat transcript scrolling | 1 raw scroll viewport plus custom message rows | open |

## Rule checklist

- [x] Project configuration captured with `shadcn info -c packages/ui --json`.
- [x] Official Base UI docs queried for Dialog, Field, Select, DropdownMenu, Empty, ToggleGroup, MessageScroller, Message, Bubble, Marker, and Attachment.
- [x] Registry availability confirmed for message-scroller, message, bubble, marker, attachment, dialog, alert, spinner, toggle-group, and input-group.
- [x] Shared primitive/custom-component audit complete.
- [x] Styling violations closed in routed production sources.
- [x] Form semantics closed.
- [x] Group composition closed.
- [x] Overlay/title/Base trigger composition closed.
- [x] Empty/Alert/Badge/Separator/Skeleton/Card semantics closed.
- [x] Icon composition closed.
- [x] Chat/message composition and scrolling closed.
- [x] macOS runtime walkthrough complete.

## Exceptions

No application-owned exceptions accepted yet. Any exception must identify an upstream registry file or a behavior that the official primitive demonstrably cannot preserve.

### Upstream primitive boundary

- `pnpm dlx shadcn@latest info --json -c packages/ui` identifies all 33 files in `packages/ui/src/components/ui/` as installed `base-nova` registry components.
- Those generated files are excluded only from the mechanical bans on registry-internal `dark:` selectors and portal stacking classes. Their consumer composition remains enforced in renderer code.
- `packages/ui/src/components/page-header.tsx` is the sole application-owned shared TSX composition. Its `space-y-1` violation was replaced with `flex flex-col gap-1`.
- `packages/ui/src/globals.css` now exposes `success`, `warning`, and `info` color/foreground pairs through Tailwind v4 `@theme inline`, so renderer status UI can replace raw palette classes without manual dark variants.
- Official Base UI primitives added without overwriting local `button`, `input`, or `textarea`: `dialog`, `alert`, `spinner`, `toggle`, `toggle-group`, `input-group`, `message-scroller`, `message`, `bubble`, `marker`, and `attachment`. The generated alias imports were adapted for the shared package boundary, and the required `@shadcn/react` dependency plus official scroll-fade/shimmer utility subset were added.

## Completion evidence (2026-08-19)

- The source compliance suite passed all four rule families before unrelated duplicate files appeared in the working tree: styling, Field/form semantics, grouped collections, and control-icon composition.
- Desktop production build passed (3,811 renderer modules), `@coordy/ui` typecheck passed, desktop typecheck passed, and the full desktop suite passed with 240 tests plus one skipped test.
- Focused agent-create verification passed 21 tests after correcting the ToggleGroup item height; agent-detail/create verification passed 23 tests; broader focused renderer verification passed 65 tests.
- The live macOS Electron walkthrough verified the home shell, command palette, task dialog, floating chat, and agent creation. Agent creation now shows one compact Harness selector containing only installed, ready runtimes; permission options no longer overlap.
- Agent detail uses autosave, removes the duplicate bottom save/switch/copy/archive action row, and keeps archive in the header overflow with an AlertDialog confirmation.

## Concurrent working-tree note

Two unrelated untracked duplicate files appeared after the green run: `apps/desktop/src/renderer/src/features/online-team 2.tsx` and `apps/desktop/src/main/test/auth-ipc.spec 2.ts`. They are not routed application sources and were intentionally left untouched. Their stale duplicate contents currently make an unfiltered whole-tree compliance scan and desktop typecheck fail; no test exclusion or allowlist was added to hide them.
