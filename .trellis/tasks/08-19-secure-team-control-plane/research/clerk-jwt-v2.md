# Clerk session token v2 verification notes

Official sources checked on 2026-08-19:

- Session token claims: https://clerk.com/docs/guides/sessions/session-tokens
  - Current v2 active-Organization claims are nested under `o`: `o.id` is the
    Organization ID and `o.rol` is the role key.
  - v2 role keys are `owner`, `admin`, or `member`; they do not use the legacy
    `org:` prefix.
  - A token may be cryptographically valid while `sts` is `pending`. Team APIs
    must require an active session and reject pending tokens.
- Manual JWT verification: https://clerk.com/docs/guides/sessions/manual-jwt-verification
  - Verify the RS256 signature using Clerk JWKS, then validate time, issuer,
    audience, authorized party, subject, and session claims.
  - Clerk documents `azp` as optional when the request did not carry an Origin.
- Verify token reference: https://clerk.com/docs/reference/backend/verify-token
  - `audience` and `authorizedParties` are explicit verifier restrictions.

Coordy deliberately requires `azp` on every protected online-team request. The
desktop auth renderer uses the fixed `http://localhost:3000` origin, so an absent
Origin is not part of the approved flow. Strict `azp` prevents a valid token
minted for another browser origin from being replayed to this control plane.

Development instance public configuration (no secret required):

- Issuer: `https://national-monkfish-7734.clerk.accounts.dev`
- JWKS: `https://national-monkfish-7734.clerk.accounts.dev/.well-known/jwks.json`

The server fetches only public JWKS data. It neither accepts nor logs a Clerk
secret key or session token.
