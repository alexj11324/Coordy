Desktop coding rules: no Node in the renderer, no generic IPC, import primitives from `@coordy/ui` only.

Product: rewrite Multica’s desktop experience on Coordy’s kernel protocol. Do not copy Multica source. Missing surfaces (chat, projects, autopilots, squads, skills, stats) are real work, not out of scope.

Provider identity rule: trace first-class provider artwork from the current Multica `ProviderLogo` source and render it into the shared local `assets/provider-icons` set. The desktop and both READMEs must use that same set. Never substitute invented monograms, generic icons, or an unrelated vendor mark. Keep exact coverage tests for the 23 Multica runtimes plus Gemini.

Model catalog rule: follow Multica's current per-provider discovery strategy. Query native CLI catalogs or ACP `session/new` where supported; use a maintained static catalog only where the upstream CLI exposes no model-list API (currently Claude Code); show runtime-managed/default when discovery is unsupported or fails. Never invent model IDs in renderer code.
