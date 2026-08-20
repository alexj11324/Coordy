# Clerk browser OAuth setup

Coordy does not render Clerk inside Electron. Selecting **在浏览器登录** opens
Clerk's hosted authorization page in the user's default browser. Clerk returns
to the registered `coordy://oauth/callback` protocol after an Authorization
Code + PKCE S256 flow.

Create an OAuth Application in the Clerk Dashboard with these settings:

- Public client: enabled (client secret is not used)
- Redirect URI: `coordy://oauth/callback`
- Scopes: `openid profile email user:org:read`
- Access token format: JWT
- Consent screen: enabled

Copy `.env.example` to `.env.local` in `apps/desktop` and configure only public
values:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_CLERK_OAUTH_CLIENT_ID=oauth_client_...
```

The publishable key is used only to derive and validate the exact Clerk issuer.
`VITE_CLERK_APPROVED_ORIGIN` is required only for an approved custom Clerk
Frontend API domain. Never put `CLERK_SECRET_KEY` or any other secret in a
`VITE_` variable.

OAuth state, nonce, and PKCE verifier exist only in Electron's main process for
the duration of a login. Access and refresh tokens are encrypted with Electron
`safeStorage` and never cross the preload bridge, enter renderer state, or get
logged. If operating-system encryption is unavailable, online sign-in fails
closed while local Coordy remains usable.

Account and Organization management links open Clerk's hosted Account Portal.
After creating or changing an Organization, use **切换团队** to authorize again
and select the Organization for the new access token.
