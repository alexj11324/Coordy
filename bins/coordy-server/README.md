# Coordy team control plane

`coordy-server` is the authenticated authority for explicitly shared online
team state. Local-only Coordy continues to use `coordyd` and does not require
this server.

The server accepts JWT access tokens issued by the configured Clerk OAuth
Application. It verifies RS256, signature, `exp`, `nbf`, exact issuer,
audience, `sub`, and the selected `org_id` before doing any work. It then calls
the Clerk Backend API for that user's current Organization membership and role;
client token claims are never trusted as role authority.

Load the Clerk Backend API secret only into the server environment. The desktop
app must never receive it:

```sh
CLERK_SECRET_KEY='from-your-secret-manager' cargo run -p coordy-server -- \
  --database ./coordy-control-plane.sqlite3 \
  --clerk-issuer https://national-monkfish-7734.clerk.accounts.dev \
  --clerk-jwks-url https://national-monkfish-7734.clerk.accounts.dev/.well-known/jwks.json \
  --clerk-audience oauth_client_... \
  --clerk-authorized-party coordy://oauth/callback
```

`--clerk-audience` must be the OAuth Application's public client ID. The
authorized-party flag remains required for compatibility with Clerk Session
Token v2 clients; OAuth access tokens are instead bound to the public client by
their signed audience and PKCE exchange.

The SQLite database uses WAL mode. It contains server-owned principals,
canonical shared kernel state, workspace versions, idempotency results,
append-only audit entries, and explicitly shared attachment bytes. Tokens,
secrets, local filesystem paths, private/principal memory, and Agent runtime
state are rejected and must not be placed in this database or logs.
