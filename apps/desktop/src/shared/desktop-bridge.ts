import type {
  AuthenticatedCommand,
  AuthorizedQuery,
  Effect,
  Outcome,
  View,
  AppInfo,
  InstallCliResult,
  SecretStatus,
  SetSecretInput,
  DiscoveredAgentView,
  ImportAgentsResult,
  DraftCompletion,
} from "@coordy/protocol";

export type DirEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export interface CoordyDesktopBridge {
  submit(command: AuthenticatedCommand): Promise<Outcome>;
  view(query: AuthorizedQuery): Promise<View>;
  subscribe(listener: (effect: Effect) => void): () => void;
  chooseRepository(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
  openTerminal(path: string): Promise<void>;
  listDirectory(path: string): Promise<DirEntry[]>;
  getAppInfo(): Promise<AppInfo>;
  installCli(): Promise<InstallCliResult>;
  secretsStatus(): Promise<SecretStatus>;
  setSecret(input: SetSecretInput): Promise<SecretStatus>;
  clearSecret(): Promise<SecretStatus>;
  completeDraft(kind: string, prompt: string): Promise<DraftCompletion>;
  discoverAgents(refresh?: boolean): Promise<DiscoveredAgentView[]>;
  importAgents(input: {
    workspace_id: string;
    principal_id: string;
    ids?: string[] | null;
  }): Promise<ImportAgentsResult>;
  quit(): Promise<void>;
}
