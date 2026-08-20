# Design

Run one `coordy-server` instance behind Cloudflare/TLS on the authoritative OCI host with a persistent SQLite/attachment volume and supervised restarts. Clerk public configuration is distributed to the desktop build; Clerk JWT verification material and any Backend API secret remain host-side. The service domain, Clerk authorized parties, redirects, and desktop callback behavior must exactly agree.

Deployment acceptance is not inferred from local tests: the OCI host build/migration, public HTTPS API, two separate Clerk sessions, invitation email, live update, restart persistence, authorization denial, backup restore, and local-offline fallback are all exercised.
