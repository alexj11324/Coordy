# Clerk official documentation notes

Sources checked on 2026-08-19:

- React quickstart: https://clerk.com/docs/react/getting-started/quickstart
  - Current React package is `@clerk/react`.
  - Vite exposes only `VITE_CLERK_PUBLISHABLE_KEY` to the client.
  - `ClerkProvider` owns client session context.
- Organizations overview: https://clerk.com/docs/guides/organizations/overview
  - Organizations provide active-team context, memberships, roles, and switching.
- Organization getting started: https://clerk.com/docs/react/guides/organizations/getting-started
  - `OrganizationSwitcher` supports create/switch/manage flows.
- Invitations: https://clerk.com/docs/guides/organizations/add-members/invitations
  - Clerk prebuilt components/Account Portal support send, manage, and accept flows.
  - Email must be enabled for invitation delivery.
- Session tokens: https://clerk.com/docs/guides/sessions/session-tokens
  - Session tokens are short-lived JWTs for backend authentication.
- Manual verification: https://clerk.com/docs/guides/sessions/manual-jwt-verification
  - Backends must verify signature and expiry and should restrict authorized parties.
- CSP headers: https://clerk.com/docs/guides/secure/best-practices/csp-headers
  - Clerk auth surfaces require the instance FAPI host, `challenges.cloudflare.com`, `*.protect.clerk.com`, `img.clerk.com`, and `worker-src 'self' blob:` in their documented directives.
- Backend Instance allowed origins: https://clerk.com/docs/reference/backend/types/backend-instance
  - Browser-like stacks including Electron must add the request origin to the Clerk instance allowed origins.
  - Clerk documents `http://localhost:3000` as Electron's default origin; a production `file://` page is not an acceptable assumed web origin.

There is no dedicated official Electron quickstart. Treat Electron WebContents isolation, CSP, navigation, session restoration, and redirect behavior as runtime acceptance targets instead of assuming the browser quickstart is sufficient. Remote Clerk JavaScript must not share a renderer with Coordy's privileged product bridge.
