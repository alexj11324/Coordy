# Integrate Clerk account authentication

## Goal

Deliver complete online human-team collaboration while preserving Coordy's signed-out local mode. Clerk owns account and Organization membership; Coordy's server owns authenticated, durable team-workspace state; local Agent collaboration remains usable without login.

## Background and confirmed facts

- The desktop app is Electron 35 with a React 19 + Vite renderer and currently has no Clerk dependency (`apps/desktop/package.json`).
- `App` currently bootstraps a local workspace and local principal before rendering the router (`apps/desktop/src/renderer/src/app.tsx`).
- `useSession` represents Coordy's local workspace actor (`daemon`, `principal`, or `agent`), not a remote product-account session (`apps/desktop/src/renderer/src/state/session-store.ts`).
- The sidebar identity control currently switches among local principals and agents; it does not sign a product account in or out (`apps/desktop/src/renderer/src/shell/nav-user.tsx`).
- Electron runs with context isolation and a narrow preload bridge. New authentication work must preserve that boundary and must not expose secret keys or raw long-lived credentials to the renderer.
- The current CSP and navigation/window-open policies permit only existing local content and allowlisted external URLs. Clerk networking and any external-browser callback therefore need explicit treatment in the design (`apps/desktop/src/main/index.ts`).
- Clerk's current React quickstart uses `@clerk/react`, a client-visible Vite publishable key, and a top-level `ClerkProvider`. Clerk session tokens are short-lived JWTs intended for authenticated backend requests; a Clerk secret key must never be bundled into the desktop client.
- Clerk documents custom-scheme redirect URLs, but does not publish a dedicated Electron SDK/quickstart. The desktop redirect and session-restoration path must therefore be validated against the packaged Electron runtime rather than assumed from a browser-only example.

## Requirements

- Use Clerk as the source of truth for the product account session.
- Keep local-only Coordy usable while signed out. Authentication is required only at the boundary of capabilities that interact with other human users or a remote team service.
- Use Clerk Organizations for creating, joining, inviting, switching, and administering human teams with `owner/admin/member`-equivalent authorization.
- Treat current local principals and Agent squads as local product entities, not Clerk users or Organizations; do not gate local Agent collaboration.
- A team workspace must be durable and visible to authorized members on separate clients. Its canonical mutations must be authorized and applied server-side rather than accepted as renderer-authored snapshots.
- Synchronize the current workspace-shared product surface needed for real collaboration: workspace metadata, human membership projection, projects, tasks and dependencies, comments, labels, shared Agent definitions and Skills, shared automation definitions, contracts, conflicts, published shared memory, and explicitly shared attachments.
- Keep host-local and private state local: Agent/private principal memory, provider keys, Clerk secret keys, Harness credentials/configuration, local repository paths, processes, computers, and unpublished attachments never enter a sync payload.
- Support an observable signed-out state, sign-in/sign-up entry, signed-in identity display, persisted session restoration after app restart, and sign-out.
- Use only the Clerk publishable key in client-side configuration. Never commit or bundle a Clerk secret key, session token, refresh token, or user credential.
- Keep Coordy's local `Actor`/principal authorization model distinct from Clerk account identity unless an explicit binding contract is approved.
- Preserve Electron's context isolation, navigation restrictions, external-link validation, and local daemon ownership boundaries.
- Missing or invalid Clerk configuration must produce an actionable app state or startup error and must not silently impersonate an authenticated user.
- Authentication tests must be deterministic and must not require real user credentials in CI.

## Acceptance Criteria

- [ ] With valid Clerk configuration, a signed-out user can start authentication and complete the configured sign-in/sign-up flow.
- [ ] After successful authentication, the desktop UI displays the Clerk user's stable identity (name/email/avatar as available) and exposes a sign-out action.
- [ ] Closing and reopening the app restores the valid Clerk session without asking the user to sign in again.
- [ ] Signing out removes the active product-account session while preserving access to local-only workspaces, agents, tasks, projects, automations, and other approved offline capabilities.
- [ ] A signed-out user who invokes a login-required collaboration capability sees a clear sign-in prompt and can resume the intended destination after authentication.
- [ ] A signed-in user can create or join a Clerk Organization, invite a second real user by email, accept the invitation, and switch active teams.
- [ ] Two separately authenticated clients in the same team can open the same team workspace and observe authorized changes without restart; disallowed members and roles receive a server-side denial.
- [ ] Team workspace state survives server and desktop restarts and concurrent updates do not silently replace unrelated changes.
- [ ] The server derives the Clerk user and active Organization from a verified short-lived token and never trusts client-provided membership or role claims without signature and tenant checks.
- [ ] No secret Clerk key or reusable credential is present in renderer bundles, committed files, logs, IPC payload fixtures, or test snapshots.
- [ ] Existing local workspace/principal/agent behavior remains correct under the approved account-gating policy.
- [ ] Focused auth tests, desktop unit tests, typecheck, build, and a real Electron authentication-path smoke test pass; any Clerk Dashboard setup needed for the real flow is documented.

## Out of Scope

- Replacing Coordy's kernel authority model with renderer-owned authorization.
- Implementing billing, subscriptions, organizations, roles, invitations, or cloud workspace synchronization.
- Hosted Agent execution; team members continue to run Agents on their own authorized local devices.
- Billing, Clerk custom paid roles, enterprise SSO, verified domains, or SCIM.
- Committing Clerk dashboard secrets or automating dashboard changes without separate authorization.

## Delivery Map

1. `08-19-clerk-desktop-identity`: Clerk account, Organization, invitation, switcher, and reusable collaboration gate in Electron.
2. `08-19-secure-team-control-plane`: verified Clerk JWTs, tenant/role authorization, durable shared kernel state, audit, and attachment authorization.
3. `08-19-team-workspace-sync`: desktop team workspace mode, shared commands/views/watch, reconnect/conflict behavior, and local/private exclusion.
4. `08-19-deploy-team-collaboration`: Clerk/OCI/Cloudflare configuration and two-client runtime acceptance.
