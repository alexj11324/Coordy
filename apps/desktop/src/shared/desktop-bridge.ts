import type {
  AuthenticatedCommand,
  AuthorizedQuery,
  Effect,
  Outcome,
  View,
  AppInfo,
  InstallCliResult,
} from "@coordy/protocol";

export interface CoordyDesktopBridge {
  submit(command: AuthenticatedCommand): Promise<Outcome>;
  view(query: AuthorizedQuery): Promise<View>;
  subscribe(listener: (effect: Effect) => void): () => void;
  chooseRepository(): Promise<string | null>;
  revealFile(path: string): Promise<void>;
  openTerminal(path: string): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
  installCli(): Promise<InstallCliResult>;
}
