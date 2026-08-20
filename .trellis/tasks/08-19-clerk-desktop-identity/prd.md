# Clerk desktop identity and organization flows

## Goal

Add optional Clerk identity and complete human-team account flows to the Electron desktop shell without gating local-only Coordy or conflating Clerk users with local principals/Agents.

## Requirements

- Configure `@clerk/react` with a Vite publishable key; no secret key or persistent token may enter the repository or renderer bundle.
- Signed-out users retain all local workspace and Agent capabilities.
- The account UI supports sign in/up, restored session, identity display, sign out, Organization create/switch/manage, invitation sending, and invitation acceptance.
- Human-team entry points use a reusable gate that prompts sign-in and resumes the requested destination. Existing local members, squads, tasks, projects, and Agents are not gated.
- Missing Clerk configuration leaves local mode usable and clearly explains why online team actions are unavailable.
- Preserve context isolation, strict navigation, CSP, and validated external URL handling.
- Isolate Clerk and every remotely loaded authentication script in a dedicated WebContents that has no access to Coordy's product preload/IPC bridge.
- A well-formed but invalid, revoked, or unreachable Clerk configuration must enter an actionable online-auth error state without blocking local mode.
- Tests use a deterministic auth adapter/fake rather than real credentials.

## Acceptance Criteria

- [ ] Signed-out launch reaches the existing local app and local Agent flows still work.
- [ ] A configured user can sign in, restore the session after restart, see identity, and sign out.
- [ ] A signed-in user can create/switch/manage Organizations and initiate/accept an email invitation through the approved Clerk flow.
- [ ] A team-only action prompts login when signed out and resumes after login; local routes never prompt.
- [ ] Missing/invalid publishable-key configuration is actionable and does not break local bootstrap.
- [ ] Security tests prove no Clerk-capable renderer can call product daemon, filesystem, terminal, secret, install, import, or quit IPC.
- [ ] Focused auth UI tests, IPC/security tests, desktop test suite, typecheck, build, and a real Electron smoke path pass.

## Out of Scope

- Persisting Coordy team workspace data; owned by the control-plane and sync children.
- Treating local principals or Agent squads as Clerk members or Organizations.
