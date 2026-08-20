# Design

## Boundaries

- `@clerk/react` and all remotely loaded Clerk JavaScript run only in a dedicated sandboxed authentication `BrowserWindow` / `WebContents`. That window never receives Coordy's product preload or `window.coordy` bridge.
- The authentication window has a dedicated narrow preload/IPC contract for sanitized account/Organization status and auth-surface commands. Product commands, filesystem access, terminal launch, secrets, CLI installation, and daemon RPC are unavailable there.
- The main product renderer never imports or executes Clerk. A small product-side account store consumes sanitized status from the main process and exposes signed-out/signed-in/config-missing/load-error states.
- `RequireOnlineAccount` gates only explicit human-team actions and preserves the intended destination.
- Clerk prebuilt account/Organization surfaces in the isolated auth window handle sign-in, profile, team create/switch/manage, and invitation flows. This avoids implementing credential or invitation-token handling in Coordy.
- The packaged auth document is served only from `http://localhost:3000`, which must be registered in Clerk Dashboard Allowed origins. A loopback-only server exposes the auth HTML and its exact referenced assets; bind or asset failure becomes `config-error` and never falls back to `file://`.
- The auth renderer sends an explicit ready handshake only after Clerk has loaded and the command listener is mounted. Main queues requested surfaces until that handshake, so a fresh slow load cannot lose a sign-in/team command.
- OAuth is explicitly requested as a popup flow. Only HTTPS/blank popups may be created, and provider redirects run in a sandboxed same-partition child with no preload, Node, product bridge, or nested popups. The main auth shell remains restricted to its local and pinned Clerk origins.
- The Electron main process applies Clerk's required CSP origins only to the isolated auth window; the product renderer keeps its existing CSP. The Clerk instance origin must match an explicitly pinned expected origin rather than trusting any hostname encoded in a publishable key.
- The packaged auth renderer is served from one stable loopback origin that can be explicitly allowlisted in the Clerk instance. It must not rely on `file://`/opaque origin behavior. The server exposes only packaged auth assets, binds loopback, rejects traversal/invalid hosts, and has deterministic startup/shutdown failure behavior.

## Data flow

`VITE_CLERK_PUBLISHABLE_KEY + pinned origin -> isolated auth window -> sender-validated narrow IPC -> normalized product account store -> account/team UI and collaboration gate`

Local `useSession` continues to own Coordy workspace/principal/Agent actor state. No Clerk ID is written into that store in this child.

## Security

- Never log Clerk tokens or user credential fields.
- The product renderer never receives a session token. A later main-process team transport may request a short-lived token through the isolated auth boundary and pass it only to the server, where it is verified.
- Main process validates product and auth IPC senders against their exact WebContents identity and permitted origin.
- The main auth shell remains within validated Clerk or local callback origins. OAuth provider redirects are allowed only inside the isolated no-preload popup; arbitrary schemes, main-window escapes, and nested popups remain denied.
- Clerk load/config/network failure becomes an actionable `load-error` state while local Coordy remains usable.

## Compatibility and rollback

Without a publishable key the product selects local-only mode, so existing development and CI remain operational. Removing the auth window/store/UI restores the current shell without data migration.
