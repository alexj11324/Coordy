import type {
  AuthenticatedCommand,
  AuthorizedQuery,
  Command,
  Outcome,
  Query,
  View,
} from "@coordy/protocol";
import type {
  CoordyDesktopBridge,
  CoordyDesktopEvent,
  DirEntry,
} from "../../../shared/desktop-bridge";
import type { AuthSurface, SanitizedAuthState } from "../../../shared/auth-bridge";

const OUTCOME_ID: Partial<Record<Command["type"], string>> = {
  CreateWorkspace: "workspace_id",
  CreatePrincipal: "principal_id",
  CreateConfiguredAgent: "agent_id",
  CreateAgent: "agent_id",
  CreateTask: "task_id",
  StartRun: "run_id",
  CreateProject: "project_id",
  CreateAutomation: "automation_id",
  CreateSquad: "squad_id",
  CreateSkill: "skill_id",
  CreateChat: "chat_id",
};

function defaultView(query: Query): View {
  switch (query.type) {
    case "Health":
      return {
        type: "Health",
        status: "ok",
        version: "test",
        protocol_version: "coordy-local-v1",
        pid: 1,
        workspace_count: 0,
      };
    case "Workspaces":
      return { type: "Workspaces", items: [] };
    case "Principals":
      return { type: "Principals", items: [] };
    case "Agents":
      return { type: "Agents", items: [] };
    case "Board":
      return { type: "Board", tasks: [] };
    case "Projects":
      return { type: "Projects", items: [] };
    case "Automations":
      return { type: "Automations", items: [] };
    case "Squads":
      return { type: "Squads", items: [] };
    case "Skills":
      return { type: "Skills", items: [] };
    case "Runs":
      return { type: "Runs", items: [] };
    case "Chats":
      return { type: "Chats", items: [] };
    case "Stats":
      return {
        type: "Stats",
        stats: {
          issue_count: 0,
          open_count: 0,
          done_count: 0,
          agent_count: 0,
          run_count: 0,
          project_count: 0,
        },
      };
    default:
      throw new Error(`no default fake view for ${query.type}`);
  }
}

export class StatefulCoordyBridge implements CoordyDesktopBridge {
  readonly commands: AuthenticatedCommand[] = [];
  readonly queries: AuthorizedQuery[] = [];
  readonly calls: string[] = [];
  readonly failCommands = new Map<Command["type"], string>();
  readonly failQueries = new Map<Query["type"], string>();
  readonly views = new Map<Query["type"], View>();
  private readonly listeners = new Set<(event: CoordyDesktopEvent) => void>();
  private nextId = 1;

  async submit(command: AuthenticatedCommand): Promise<Outcome> {
    this.commands.push(command);
    this.calls.push(`submit:${command.command.type}`);
    const failure = this.failCommands.get(command.command.type);
    if (failure) throw new Error(failure);
    const idKey = OUTCOME_ID[command.command.type];
    return {
      message: "ok",
      ids: idKey ? { [idKey]: `${idKey}_${this.nextId++}` } : {},
      blocked: false,
    };
  }

  async view(query: AuthorizedQuery): Promise<View> {
    this.queries.push(query);
    this.calls.push(`view:${query.query.type}`);
    const failure = this.failQueries.get(query.query.type);
    if (failure) throw new Error(failure);
    return this.views.get(query.query.type) ?? defaultView(query.query);
  }

  subscribe(listener: (event: CoordyDesktopEvent) => void): () => void {
    this.calls.push("subscribe");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: CoordyDesktopEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async chooseRepository(): Promise<string | null> {
    this.calls.push("chooseRepository");
    return "/tmp/coordy-test-repo";
  }
  async revealFile(path: string): Promise<void> {
    this.calls.push(`revealFile:${path}`);
  }
  async openTerminal(path: string): Promise<void> {
    this.calls.push(`openTerminal:${path}`);
  }
  async listDirectory(path: string): Promise<DirEntry[]> {
    this.calls.push(`listDirectory:${path}`);
    return [];
  }
  async getAppInfo() {
    this.calls.push("getAppInfo");
    return { version: "test", os: "test", cliPath: "/tmp/coordy" };
  }
  async installCli() {
    this.calls.push("installCli");
    return { ok: true, message: "installed" };
  }
  async suggestTaskSplit() {
    this.calls.push("suggestTaskSplit");
    return { titles: ["one", "two"] };
  }
  async discoverAgents(refresh = false) {
    this.calls.push(`discoverAgents:${refresh}`);
    return [];
  }
  async discoverHarnessModels(harness: string) {
    this.calls.push(`discoverHarnessModels:${harness}`);
    return {
      models: [],
      model_selection_supported: false,
      source: "unavailable",
    };
  }
  async importAgents() {
    this.calls.push("importAgents");
    return { imported: [], skipped: [] };
  }
  async authState(): Promise<SanitizedAuthState> {
    this.calls.push("authState");
    return { status: "config-missing", identity: null, organization: null };
  }
  async openAuth(surface: AuthSurface) {
    this.calls.push(`openAuth:${surface}`);
  }
  async signOutAuth() {
    this.calls.push("signOutAuth");
  }
  subscribeAuth(listener: (state: SanitizedAuthState) => void) {
    this.calls.push("subscribeAuth");
    void listener;
    return () => undefined;
  }
  async quit(): Promise<void> {
    this.calls.push("quit");
  }
}
