# Multica behavior evidence: conversational decomposition

## Snapshot

- Repository: `https://github.com/multica-ai/multica`
- Inspected commit: `7fdc854c262a516b11ceb50a4a666b217b67f29d`
- Local research clone: `/private/tmp/multica-task-decomposition`

## Findings

Multica chat is a private agent conversation and does not automatically create
issues. When the user explicitly asks, the chat agent can act with workspace
permissions and use the product CLI. The core agent brief advertises issue
creation with parent and stage fields. A non-user-invocable built-in skill,
`multica-working-on-issues`, adds the operational rules that a generic coding
agent would not know:

- create child issues with `--parent`;
- use `todo` when work should start immediately and `backlog` when it should be
  parked;
- use stages for ordered barriers;
- promote later stages only when dependencies are met;
- handle parent notification after child completion.

The server owns actual status effects and stage barriers. The skill explains
how to call them; it is not the source of authority. Multica does not provide
the exact review-first atomic plan proposal required here, so Coordy's preview,
idempotent bulk apply, and kernel preflight are an independent design rather
than a copied implementation.

## Coordy consequence

Coordy needs both layers:

1. a built-in planning skill and structured artifact contract so a chat agent
   can express a complete plan consistently; and
2. kernel commands and invariants so invalid, unauthorized, cyclic, partial, or
   duplicate plans cannot commit.

Relevant Multica sources inspected:

- `apps/docs/content/docs/chat.zh.mdx`
- `server/internal/daemon/execenv/runtime_config_sections.go`
- `server/internal/service/builtin_skills/multica-working-on-issues/SKILL.md`
- `server/internal/handler/issue_child_done.go`

No source, component, API model, or asset is copied into Coordy.
