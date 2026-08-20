# Implementation Plan

1. Add the Clerk React dependency and typed Vite configuration without committing credentials.
2. Add an isolated Clerk authentication window with a dedicated narrow preload/IPC contract and no product bridge.
3. Add a normalized product-side account store with configured, loading, load-error, signed-out, signed-in, and active-Organization states.
4. Add account/team entry surfaces to the existing identity/settings/workspace UI and a reusable human-team collaboration gate; render actual Clerk account/Organization UI only inside the isolated window.
5. Apply Clerk's documented CSP/network origins only to the auth window, pin the expected Clerk origin, and preserve the product window policy.
6. Add deterministic unit/component/security tests for isolation, sender validation, local-only, signed-out, signed-in, Organization, invitation entry, sign-out, missing-config, and Clerk load-error states.
7. Run desktop tests, typecheck, build, secret scan, and Electron smoke validation.

Rollback point: dependency/provider/UI/policy changes are isolated from the local daemon and can be reverted without touching kernel data.
