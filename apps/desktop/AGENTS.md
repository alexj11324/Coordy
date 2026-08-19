Desktop coding rules: no Node in the renderer, no generic IPC, import primitives from `@coordy/ui` only.

Product: rewrite Multica’s desktop experience on Coordy’s kernel protocol. Do not copy Multica source. Missing surfaces (chat, projects, autopilots, squads, skills, stats) are real work, not out of scope.

Provider identity rule: every first-class provider row must have an explicit provenance and verification-status record alongside the shared local `assets/provider-icons` set. Only rows backed by a provider-controlled source or the exact ACP Registry integration may claim that verification; legacy and third-party marks must say so. Multica comments are comparison evidence, not provenance. The desktop and both READMEs must use the same identity set. Never substitute invented monograms, generic icons, or an unrelated vendor mark. Keep exact coverage tests for the current 23 consumer runtimes; a backward-compatible runtime may remain supported without being advertised as first-class.

Model catalog rule: follow Multica's current per-provider discovery strategy. Query native CLI catalogs or ACP `session/new` where supported; use a maintained static catalog only where the upstream CLI exposes no model-list API (currently Claude Code); show runtime-managed/default when discovery is unsupported or fails. Never invent model IDs in renderer code.
