export const IPC = {
  submit: "coordy:submit",
  view: "coordy:view",
  subscribe: "coordy:subscribe",
  effect: "coordy:effect",
  chooseRepository: "coordy:choose-repository",
  revealFile: "coordy:reveal-file",
  openTerminal: "coordy:open-terminal",
  getAppInfo: "coordy:get-app-info",
  installCli: "coordy:install-cli",
  suggestTaskSplit: "coordy:suggest-task-split",
  discoverAgents: "coordy:discover-agents",
  discoverHarnessModels: "coordy:discover-harness-models",
  importAgents: "coordy:import-agents",
  listDirectory: "coordy:list-directory",
  authState: "coordy:auth-state",
  authOpen: "coordy:auth-open",
  authSignOut: "coordy:auth-sign-out",
  authChanged: "coordy:auth-changed",
  quit: "coordy:quit",
} as const;

export const PRODUCT_IPC_CHANNELS = Object.entries(IPC)
  .filter(([key]) => !key.startsWith("auth") && key !== "effect" && key !== "subscribe")
  .map(([, channel]) => channel);
