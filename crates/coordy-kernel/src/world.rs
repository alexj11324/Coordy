use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EffectRecord {
    pub cursor: u64,
    pub effect: coordy_protocol::Effect,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct World {
    pub workspaces: Vec<Workspace>,
    pub principals: Vec<Principal>,
    pub agents: Vec<Agent>,
    pub grants: Vec<Grant>,
    pub commitments: Vec<Commitment>,
    pub memories: Vec<MemoryRecord>,
    pub tasks: Vec<Task>,
    pub contracts: Vec<Contract>,
    pub dependencies: Vec<DependencyEdge>,
    pub conflicts: Vec<Conflict>,
    pub runs: Vec<Run>,
    pub run_events: Vec<RunEvent>,
    pub inbox: Vec<InboxItem>,
    pub audit: Vec<AuditEntry>,
    pub snapshots: Vec<CompactionSnapshot>,
    pub effects: Vec<EffectRecord>,
    pub paused_runs: Vec<String>,
    #[serde(default)]
    pub llm_advisor_enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo_path: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Principal {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub workspace_id: String,
    pub principal_id: String,
    pub name: String,
    pub harness: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grant {
    pub id: String,
    pub workspace_id: String,
    pub grantor_id: String,
    pub grantee_id: String,
    pub resource: String,
    pub action: String,
    pub delegated: bool,
    pub revoked: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commitment {
    pub id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub commitment_type: String,
    pub claim: String,
    pub polarity: String,
    pub authority: String,
    pub status: String,
    pub scope: String,
    pub owner_actor_id: String,
    pub superseded_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub workspace_id: String,
    pub visibility: String,
    pub owner_actor_id: String,
    pub body: String,
    pub status: String,
    pub share_to: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub worktree_path: Option<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Contract {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub participant_ids: Vec<String>,
    pub approvals: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub id: String,
    pub workspace_id: String,
    pub from_id: String,
    pub to_id: String,
    pub entity: String,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conflict {
    pub id: String,
    pub workspace_id: String,
    pub summary: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub status: String,
    pub harness: String,
    pub compaction_count: usize,
    pub after_compaction: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunEvent {
    pub run_id: String,
    pub seq: u32,
    pub kind: String,
    pub payload: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub related_id: Option<String>,
    pub dismissed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub at: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompactionSnapshot {
    pub run_id: String,
    pub task_id: String,
    pub claims: Vec<String>,
    #[serde(default)]
    pub rejected: Vec<String>,
}

impl World {
    pub fn workspace(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    pub fn principal(&self, id: &str) -> Option<&Principal> {
        self.principals.iter().find(|p| p.id == id)
    }

    pub fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|a| a.id == id)
    }

    pub fn task(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }

    pub fn task_mut(&mut self, id: &str) -> Option<&mut Task> {
        self.tasks.iter_mut().find(|t| t.id == id)
    }

    pub fn run(&self, id: &str) -> Option<&Run> {
        self.runs.iter().find(|r| r.id == id)
    }

    pub fn run_mut(&mut self, id: &str) -> Option<&mut Run> {
        self.runs.iter_mut().find(|r| r.id == id)
    }

    pub fn memory(&self, id: &str) -> Option<&MemoryRecord> {
        self.memories.iter().find(|m| m.id == id)
    }

    pub fn memory_mut(&mut self, id: &str) -> Option<&mut MemoryRecord> {
        self.memories.iter_mut().find(|m| m.id == id)
    }

    pub fn agents_of(&self, principal_id: &str) -> Vec<&Agent> {
        self.agents
            .iter()
            .filter(|a| a.principal_id == principal_id)
            .collect()
    }

    pub fn next_effect_cursor(&self) -> u64 {
        self.effects.len() as u64
    }
}
