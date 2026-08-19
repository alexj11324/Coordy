# Repair task chat stats and navigation flows

## Goal

Make the main user flows operate on the entity the UI shows and keep private backing records out of user-visible issue surfaces.

## Requirements

- Home event display, status text, open action, and cancel action must resolve from one active run.
- My Tasks and issue-count statistics must exclude chat backing tasks while run statistics may still include chat runs.
- “New chat” must clear the active chat and enter the creation state.
- Workspace changes must normalize selected agent state; an explicit invalid ID must be rejected rather than silently replaced.
- Unknown/stale routes must show a recoverable not-found destination.
- Add focused error feedback for any touched mutation path that currently produces an unhandled rejection.

## Acceptance criteria

- [ ] A pinned older Home run cannot open or cancel a newer run.
- [ ] Creating chats does not change visible issue counts or My Tasks contents.
- [ ] New Chat with an existing active ID presents a fresh creation state.
- [ ] Switching workspaces cannot dispatch to an agent different from the visible selection.
- [ ] Every declared and legacy route renders or redirects; an unknown route renders recovery UI.
- [ ] Focused kernel and renderer tests, desktop typecheck, and build pass.

## Out of scope

- Changing the private chat-to-task implementation itself.
- New catalog features or visual redesign.

## Open questions

None.
