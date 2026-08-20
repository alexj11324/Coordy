# Deploy and validate online team collaboration

## Goal

Deploy the authenticated team stack and prove the real invitation and two-client collaboration path.

## Requirements

- Use the default low-cost target: OCI single host and a dedicated Cloudflare-managed `nebula-spaces.com` service subdomain unless the user overrides it.
- Keep Clerk/Cloudflare/server secrets in the approved secret store or host secret manager, never the repository.
- Configure TLS, strict CORS/authorized parties, process supervision, persistent volume backup, health checks, and rollback.
- Configure Clerk production/development redirect URLs, Organizations, email invitations, and default admin/member roles.
- Runtime acceptance uses two distinct Clerk users and separate desktop profiles without exposing credentials in logs or artifacts.

## Acceptance Criteria

- [ ] The deployed HTTPS health and authenticated APIs are reachable at the approved service domain.
- [ ] User A creates a team and invites User B; User B accepts and joins.
- [ ] Both clients view and mutate the same team workspace, receive live updates, and retain state after server restart.
- [ ] A third non-member and an insufficient-role member are denied protected actions.
- [ ] Local signed-out mode and local Agent collaboration still work during server outage.
- [ ] Backup/restore and deployment rollback are exercised and documented.
