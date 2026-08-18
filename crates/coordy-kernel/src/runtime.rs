use std::sync::{Arc, Mutex};

use coordy_advisor::{Advisor, DeterministicAdvisor, StateAssessment};
use coordy_protocol::{
    Actor, AgentContextView, AgentView, AuthenticatedCommand, AuthorizedQuery, Command,
    CommitmentView, ConflictView, ContractView, CoordyError, DependencyView, Effect, GrantView,
    HarnessEvent, HealthView, InboxView, MemoryView, Outcome, PrincipalView, Query, RunEventView,
    RunSource, RunView, View, PRODUCT_VERSION, PROTOCOL_VERSION,
};
use serde_json::json;

use crate::authority::{
    actor_in_workspace, can_command_agent, grantor_holds, matching_held_grant, would_escalate,
};
use crate::ports::Ports;
use crate::product;
use crate::verification::{
    action_conflicts, agent_cannot_supersede, deterministic_state_diff_with_rejected,
    extract_prefixed, invalidate_dependencies,
};
use crate::world::{
    Agent, AuditEntry, Commitment, CompactionSnapshot, Contract, EffectRecord, Grant, InboxItem,
    MemoryRecord, Principal, Run, RunEvent, Task, Workspace, World,
};
use crate::{ids, memory};

pub struct Kernel {
    world: Mutex<World>,
    ports: Arc<dyn Ports>,
    advisor: Arc<dyn Advisor>,
}

impl Kernel {
    pub fn new(ports: Arc<dyn Ports>, advisor: Arc<dyn Advisor>) -> Self {
        Self {
            world: Mutex::new(World::default()),
            ports,
            advisor,
        }
    }

    pub fn with_world(world: World, ports: Arc<dyn Ports>, advisor: Arc<dyn Advisor>) -> Self {
        Self {
            world: Mutex::new(world),
            ports,
            advisor,
        }
    }

    pub fn default_in_process() -> Self {
        Self::new(
            Arc::new(crate::ports::RecordingPorts::default()),
            Arc::new(DeterministicAdvisor),
        )
    }

    pub fn export_world(&self) -> World {
        self.world.lock().expect("world lock").clone()
    }

    pub fn replace_world(&self, world: World) {
        *self.world.lock().expect("world lock") = world;
    }

    pub fn watch(&self, cursor: Option<u64>) -> Vec<Effect> {
        let world = self.world.lock().expect("world lock");
        let from = cursor.unwrap_or(0);
        world
            .effects
            .iter()
            .filter(|e| e.cursor >= from)
            .map(|e| e.effect.clone())
            .collect()
    }

    pub async fn submit(&self, command: AuthenticatedCommand) -> Result<Outcome, CoordyError> {
        self.submit_sync(command)
    }

    pub async fn view(&self, query: AuthorizedQuery) -> Result<View, CoordyError> {
        self.view_sync(query)
    }

    fn emit(world: &mut World, effect: Effect) {
        let cursor = world.effects.len() as u64;
        world.effects.push(EffectRecord { cursor, effect });
    }

    pub(crate) fn emit_effect(world: &mut World, effect: Effect) {
        Self::emit(world, effect);
    }

    fn audit(world: &mut World, actor: &Actor, action: &str, detail: &str) {
        world.audit.push(AuditEntry {
            at: ids::now(),
            actor: actor.id().to_string(),
            action: action.into(),
            detail: detail.into(),
        });
    }

    pub fn submit_sync(&self, envelope: AuthenticatedCommand) -> Result<Outcome, CoordyError> {
        let mut world = self.world.lock().expect("world lock");
        let actor = envelope.actor;
        match envelope.command {
            Command::CreateWorkspace { name } => {
                let id = ids::new("ws");
                let (slug, prefix) = product::default_new_workspace(&name);
                let mut slug = slug;
                let mut n = 2u32;
                while product::ensure_unique_slug(&world, &id, &slug).is_err() {
                    slug = format!("{slug}-{n}");
                    n += 1;
                }
                world.workspaces.push(Workspace {
                    id: id.clone(),
                    name: name.clone(),
                    repo_path: None,
                    created_at: ids::now(),
                    icon: String::new(),
                    description: String::new(),
                    context: String::new(),
                    slug,
                    issue_prefix: prefix,
                    next_issue_number: 1,
                    archived: false,
                });
                Self::audit(&mut world, &actor, "create_workspace", &id);
                Self::emit(
                    &mut world,
                    Effect::StateChanged {
                        workspace_id: id.clone(),
                    },
                );
                Ok(Outcome::ok(
                    "workspace created",
                    json!({ "workspace_id": id }),
                ))
            }
            Command::CreatePrincipal { workspace_id, name } => {
                if world.workspace(&workspace_id).is_none() {
                    return Err(CoordyError::not_found("workspace"));
                }
                match &actor {
                    Actor::Daemon | Actor::Principal { .. } => {}
                    Actor::Agent { .. } => {
                        return Err(CoordyError::denied("agent cannot create principals"));
                    }
                }
                if let Actor::Principal { id } = &actor {
                    if !actor_in_workspace(&world, &actor, &workspace_id)
                        && !world.principals.is_empty()
                    {
                        let _ = id;
                        if !world
                            .principals
                            .iter()
                            .any(|p| p.workspace_id == workspace_id)
                        {
                            // first principal in this workspace may be created by any principal
                        } else if !actor_in_workspace(&world, &actor, &workspace_id) {
                            return Err(CoordyError::denied("not a workspace member"));
                        }
                    }
                }
                let id = ids::new("pr");
                let role = if world
                    .principals
                    .iter()
                    .any(|p| p.workspace_id == workspace_id)
                {
                    "member".into()
                } else {
                    "owner".into()
                };
                world.principals.push(Principal {
                    id: id.clone(),
                    workspace_id: workspace_id.clone(),
                    name,
                    role,
                });
                Self::audit(&mut world, &actor, "create_principal", &id);
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "principal created",
                    json!({ "principal_id": id }),
                ))
            }
            Command::CreateAgent {
                workspace_id,
                principal_id,
                name,
                harness,
            } => {
                let Some(principal) = world.principal(&principal_id).cloned() else {
                    return Err(CoordyError::not_found("principal"));
                };
                if principal.workspace_id != workspace_id {
                    return Err(CoordyError::invalid("principal workspace mismatch"));
                }
                match &actor {
                    Actor::Principal { id } if id == &principal_id => {}
                    Actor::Daemon => {}
                    _ => {
                        return Err(CoordyError::denied(
                            "only the principal may create their agent",
                        ))
                    }
                }
                let name = normalize_agent_name(&name)?;
                if agent_name_taken(&world, &workspace_id, &name, None) {
                    return Err(CoordyError::invalid(
                        "agent name must be unique in this workspace",
                    ));
                }
                let id = ids::new("ag");
                world.agents.push(Agent {
                    id: id.clone(),
                    workspace_id: workspace_id.clone(),
                    principal_id,
                    name,
                    harness,
                    description: String::new(),
                    instructions: String::new(),
                    archived: false,
                    avatar: String::new(),
                    model: String::new(),
                    thinking: String::new(),
                    speed: String::new(),
                    access: "owner".into(),
                    access_member_ids: Vec::new(),
                    concurrency_limit: 6,
                    cli_args: String::new(),
                    mcp_servers: Vec::new(),
                    skill_ids: Vec::new(),
                });
                Self::audit(&mut world, &actor, "create_agent", &id);
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok("agent created", json!({ "agent_id": id })))
            }
            Command::UpdateAgent {
                agent_id,
                name,
                description,
                instructions,
                harness,
                avatar,
                model,
                thinking,
                speed,
                access,
                access_member_ids,
                concurrency_limit,
                cli_args,
                mcp_servers,
            } => {
                let agent = world
                    .agent(&agent_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("agent"))?;
                let allowed = match &actor {
                    Actor::Daemon => true,
                    Actor::Principal { id } => *id == agent.principal_id,
                    Actor::Agent { .. } => false,
                };
                if !allowed {
                    return Err(CoordyError::denied("only the owner may update this agent"));
                }
                if agent.archived {
                    return Err(CoordyError::invalid("archived agents cannot be updated"));
                }
                if let Some(name) = name {
                    let name = normalize_agent_name(&name)?;
                    if agent_name_taken(&world, &agent.workspace_id, &name, Some(&agent_id)) {
                        return Err(CoordyError::invalid(
                            "agent name must be unique in this workspace",
                        ));
                    }
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.name = name;
                    }
                }
                if let Some(description) = description {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.description = description;
                    }
                }
                if let Some(instructions) = instructions {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.instructions = instructions;
                    }
                }
                if let Some(harness) = harness {
                    let harness = harness.trim();
                    if harness.is_empty() {
                        return Err(CoordyError::invalid("runtime is required"));
                    }
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.harness = harness.to_string();
                    }
                }
                if let Some(avatar) = avatar {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.avatar = avatar;
                    }
                }
                if let Some(model) = model {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.model = model;
                    }
                }
                if let Some(thinking) = thinking {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.thinking = thinking;
                    }
                }
                if let Some(speed) = speed {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.speed = speed;
                    }
                }
                if let Some(access) = access {
                    if !matches!(access.as_str(), "owner" | "workspace" | "members") {
                        return Err(CoordyError::invalid("unknown access"));
                    }
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.access = access;
                    }
                }
                if let Some(access_member_ids) = access_member_ids {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.access_member_ids = access_member_ids;
                    }
                }
                if let Some(concurrency_limit) = concurrency_limit {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.concurrency_limit = concurrency_limit.max(1);
                    }
                }
                if let Some(cli_args) = cli_args {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.workspace_id = row.workspace_id.clone();
                        row.cli_args = cli_args;
                    }
                }
                if let Some(mcp_servers) = mcp_servers {
                    if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                        row.mcp_servers = mcp_servers;
                    }
                }
                Self::audit(&mut world, &actor, "update_agent", &agent_id);
                Self::emit(
                    &mut world,
                    Effect::StateChanged {
                        workspace_id: agent.workspace_id,
                    },
                );
                Ok(Outcome::ok(
                    "agent updated",
                    json!({ "agent_id": agent_id }),
                ))
            }
            Command::ArchiveAgent { agent_id } => {
                let agent = world
                    .agent(&agent_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("agent"))?;
                let allowed = match &actor {
                    Actor::Daemon => true,
                    Actor::Principal { id } => *id == agent.principal_id,
                    Actor::Agent { .. } => false,
                };
                if !allowed {
                    return Err(CoordyError::denied("only the owner may archive this agent"));
                }
                if let Some(row) = world.agents.iter_mut().find(|item| item.id == agent_id) {
                    row.archived = true;
                }
                Self::emit(
                    &mut world,
                    Effect::StateChanged {
                        workspace_id: agent.workspace_id,
                    },
                );
                Ok(Outcome::ok(
                    "agent archived",
                    json!({ "agent_id": agent_id }),
                ))
            }
            Command::Grant {
                workspace_id,
                grantee_id,
                resource,
                action,
            } => {
                let grantor_id = actor.id().to_string();
                if !grantor_holds(&world, &grantor_id, &resource, &action)
                    && !matches!(actor, Actor::Daemon | Actor::Principal { .. })
                {
                    return Err(CoordyError::denied("grantor does not hold this permission"));
                }
                if let Actor::Principal { id } = &actor {
                    if !grantor_holds(&world, id, &resource, &action)
                        && resource != format!("principal:{id}")
                        && !resource.starts_with("workspace:")
                        && !resource.starts_with("agent:")
                    {
                        return Err(CoordyError::denied("cannot grant an unheld permission"));
                    }
                }
                if world.principal(&grantee_id).is_none() && world.agent(&grantee_id).is_none() {
                    return Err(CoordyError::not_found("grantee"));
                }
                let id = ids::new("gr");
                world.grants.push(Grant {
                    id: id.clone(),
                    workspace_id,
                    grantor_id,
                    grantee_id,
                    resource,
                    action,
                    delegated: false,
                    revoked: false,
                });
                Self::audit(&mut world, &actor, "grant", &id);
                Ok(Outcome::ok("granted", json!({ "grant_id": id })))
            }
            Command::RevokeGrant { grant_id } => {
                let Some(grant) = world.grants.iter_mut().find(|g| g.id == grant_id) else {
                    return Err(CoordyError::not_found("grant"));
                };
                if grant.grantor_id != actor.id()
                    && !matches!(actor, Actor::Daemon)
                    && actor.principal_id() != Some(grant.grantor_id.as_str())
                {
                    return Err(CoordyError::denied("cannot revoke this grant"));
                }
                grant.revoked = true;
                Ok(Outcome::ok("revoked", json!({ "grant_id": grant_id })))
            }
            Command::Delegate {
                workspace_id,
                from_actor_id,
                to_actor_id,
                resource,
                action,
            } => {
                if actor.id() != from_actor_id && !matches!(actor, Actor::Daemon) {
                    return Err(CoordyError::denied("only the grant holder may delegate"));
                }
                let held = matching_held_grant(&world, &from_actor_id, &resource, &action)
                    .cloned()
                    .or_else(|| {
                        world
                            .grants
                            .iter()
                            .find(|g| {
                                !g.revoked
                                    && g.grantee_id == from_actor_id
                                    && (g.resource == "*" || g.action == "*")
                            })
                            .cloned()
                    });
                let Some(held) = held else {
                    // principals may delegate builtin ownership of their agents
                    if world.principal(&from_actor_id).is_some()
                        && grantor_holds(&world, &from_actor_id, &resource, &action)
                    {
                        let id = ids::new("gr");
                        world.grants.push(Grant {
                            id: id.clone(),
                            workspace_id,
                            grantor_id: from_actor_id,
                            grantee_id: to_actor_id,
                            resource,
                            action,
                            delegated: true,
                            revoked: false,
                        });
                        return Ok(Outcome::ok("delegated", json!({ "grant_id": id })));
                    }
                    return Err(CoordyError::denied(
                        "delegator does not hold this permission",
                    ));
                };
                if would_escalate(&held, &resource, &action) {
                    return Err(CoordyError::denied(
                        "delegated permission cannot exceed delegator",
                    ));
                }
                let id = ids::new("gr");
                world.grants.push(Grant {
                    id: id.clone(),
                    workspace_id,
                    grantor_id: from_actor_id,
                    grantee_id: to_actor_id,
                    resource,
                    action,
                    delegated: true,
                    revoked: false,
                });
                Ok(Outcome::ok("delegated", json!({ "grant_id": id })))
            }
            Command::CreateTask {
                workspace_id,
                title,
                description,
            } => {
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                let (number, identifier) = product::allocate_issue_number(&mut world, &workspace_id)?;
                let id = ids::new("task");
                let sort_key = world.tasks.len() as i64;
                world.tasks.push(Task {
                    id: id.clone(),
                    workspace_id: workspace_id.clone(),
                    title,
                    description,
                    status: "open".into(),
                    assignee_agent_id: None,
                    worktree_path: None,
                    blocked_reason: None,
                    identifier: identifier.clone(),
                    number,
                    priority: "none".into(),
                    start_date: None,
                    due_date: None,
                    labels: Vec::new(),
                    custom_fields: Vec::new(),
                    assignee_principal_id: None,
                    assignee_squad_id: None,
                    project_id: None,
                    parent_id: None,
                    stage: String::new(),
                    sort_key,
                    deleted: false,
                    pull_requests: Vec::new(),
                });
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "task created",
                    json!({ "task_id": id, "identifier": identifier, "number": number }),
                ))
            }
            Command::AssignTask { task_id, agent_id } => {
                let Some(agent) = world.agent(&agent_id).cloned() else {
                    return Err(CoordyError::not_found("agent"));
                };
                if !can_command_agent(&world, &actor, &agent_id) {
                    return Err(CoordyError::denied("cannot command this agent"));
                }
                let Some(task) = world.task_mut(&task_id) else {
                    return Err(CoordyError::not_found("task"));
                };
                if task.workspace_id != agent.workspace_id {
                    return Err(CoordyError::invalid("agent/task workspace mismatch"));
                }
                task.assignee_agent_id = Some(agent_id.clone());
                let workspace_id = task.workspace_id.clone();
                let title = task.title.clone();
                drop(task);
                product::push_notice(
                    &mut world,
                    &workspace_id,
                    "assignment",
                    "事项已指派智能体",
                    &title,
                    Some(task_id.clone()),
                );
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "assigned",
                    json!({ "task_id": task_id, "agent_id": agent_id }),
                ))
            }
            Command::UpdateTask {
                task_id,
                title,
                description,
                priority,
                start_date,
                due_date,
                labels,
                custom_fields,
                sort_key,
            } => {
                let previous = world
                    .task(&task_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                let workspace_id = previous.workspace_id.clone();
                if actor.is_agent() {
                    return Err(CoordyError::denied("agent cannot edit this issue"));
                }
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                if title.is_none()
                    && description.is_none()
                    && priority.is_none()
                    && start_date.is_none()
                    && due_date.is_none()
                    && labels.is_none()
                    && custom_fields.is_none()
                    && sort_key.is_none()
                {
                    return Err(CoordyError::invalid("nothing to update"));
                }
                if title.as_ref().is_some_and(|value| value.trim().is_empty()) {
                    return Err(CoordyError::invalid("title cannot be empty"));
                }
                if let Some(priority) = priority.as_ref() {
                    if !product::priority_ok(priority) {
                        return Err(CoordyError::invalid("unknown priority"));
                    }
                }
                let mut next_priority = previous.priority.clone();
                let mut next_start = previous.start_date.clone();
                let mut next_due = previous.due_date.clone();
                {
                    let task = world
                        .task_mut(&task_id)
                        .ok_or_else(|| CoordyError::not_found("task"))?;
                    if let Some(title) = title {
                        task.title = title;
                    }
                    if let Some(description) = description {
                        task.description = description;
                    }
                    if let Some(priority) = priority.clone() {
                        task.priority = priority;
                    }
                    if let Some(start_date) = start_date.clone() {
                        task.start_date = if start_date.is_empty() {
                            None
                        } else {
                            Some(start_date)
                        };
                    }
                    if let Some(due_date) = due_date.clone() {
                        task.due_date = if due_date.is_empty() { None } else { Some(due_date) };
                    }
                    if let Some(labels) = labels {
                        task.labels = labels;
                    }
                    if let Some(custom_fields) = custom_fields {
                        task.custom_fields = custom_fields;
                    }
                    if let Some(sort_key) = sort_key {
                        task.sort_key = sort_key;
                    }
                    next_priority = task.priority.clone();
                    next_start = task.start_date.clone();
                    next_due = task.due_date.clone();
                }
                if priority.is_some() && previous.priority != next_priority {
                    product::push_notice(
                        &mut world,
                        &workspace_id,
                        "priority",
                        "优先级变了",
                        &previous.title,
                        Some(task_id.clone()),
                    );
                } else if (start_date.is_some() || due_date.is_some())
                    && (previous.start_date != next_start || previous.due_date != next_due)
                {
                    product::push_notice(
                        &mut world,
                        &workspace_id,
                        "date",
                        "日期变了",
                        &previous.title,
                        Some(task_id.clone()),
                    );
                }
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok("task updated", json!({ "task_id": task_id })))
            }
            Command::SetTaskStatus { task_id, status } => {
                if !allowed_task_status(&status) {
                    return Err(CoordyError::invalid("unknown task status"));
                }
                let workspace_id = world
                    .task(&task_id)
                    .map(|t| t.workspace_id.clone())
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                if actor.is_agent() {
                    return Err(CoordyError::denied("agent cannot set task status"));
                }
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                let task = world
                    .task_mut(&task_id)
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                let previous = task.status.clone();
                let title = task.title.clone();
                task.status = status.clone();
                if status != "blocked" {
                    task.blocked_reason = None;
                } else if task.blocked_reason.is_none() {
                    task.blocked_reason = Some("marked blocked".into());
                }
                drop(task);
                if previous != status {
                    product::push_notice(
                        &mut world,
                        &workspace_id,
                        "status",
                        "状态变了",
                        &title,
                        Some(task_id.clone()),
                    );
                }
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "status updated",
                    json!({ "task_id": task_id, "status": status }),
                ))
            }
            Command::BindRepository { workspace_id, path } => {
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                let Some(ws) = world.workspaces.iter_mut().find(|w| w.id == workspace_id) else {
                    return Err(CoordyError::not_found("workspace"));
                };
                ws.repo_path = Some(path.clone());
                Ok(Outcome::ok("repository bound", json!({ "path": path })))
            }
            Command::CreateWorktree { task_id } => {
                let task = world
                    .task(&task_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                if let Some(agent_id) = &task.assignee_agent_id {
                    if !can_command_agent(&world, &actor, agent_id) {
                        return Err(CoordyError::denied("cannot command this agent"));
                    }
                }
                let repo = world
                    .workspace(&task.workspace_id)
                    .and_then(|w| w.repo_path.clone())
                    .ok_or_else(|| CoordyError::invalid("bind a repository first"))?;
                drop(world);
                let path = self.ports.create_worktree(&repo, &task_id)?;
                let mut world = self.world.lock().expect("world lock");
                if let Some(task) = world.task_mut(&task_id) {
                    task.worktree_path = Some(path.clone());
                }
                Ok(Outcome::ok("worktree created", json!({ "path": path })))
            }
            Command::UpsertCommitment {
                workspace_id,
                task_id,
                commitment_type,
                claim,
                polarity,
                authority,
                scope,
            } => {
                if actor.is_agent() && SUPERSEDING_AUTHORITY.contains(&authority.as_str()) {
                    return Err(CoordyError::denied(
                        "agent cannot author authoritative commitments",
                    ));
                }
                if let Some(task_id) = &task_id {
                    if let Some(old) = world.commitments.iter().find(|c| {
                        c.task_id.as_deref() == Some(task_id.as_str())
                            && c.commitment_type == commitment_type
                            && c.status == "ACTIVE"
                    }) {
                        if agent_cannot_supersede(old, &authority) {
                            return Err(CoordyError::denied(
                                "agent-authored state cannot supersede an authoritative commitment",
                            ));
                        }
                    }
                }
                if let Some(old) = world.commitments.iter_mut().find(|c| {
                    c.task_id == task_id
                        && c.commitment_type == commitment_type
                        && c.status == "ACTIVE"
                        && SUPERSEDING_AUTHORITY.contains(&c.authority.as_str())
                        && SUPERSEDING_AUTHORITY.contains(&authority.as_str())
                }) {
                    old.status = "SUPERSEDED".into();
                }
                let id = ids::new("cmt");
                world.commitments.push(Commitment {
                    id: id.clone(),
                    workspace_id,
                    task_id,
                    commitment_type,
                    claim,
                    polarity,
                    authority,
                    status: "ACTIVE".into(),
                    scope,
                    owner_actor_id: actor.id().to_string(),
                    superseded_by: None,
                });
                Ok(Outcome::ok(
                    "commitment recorded",
                    json!({ "commitment_id": id }),
                ))
            }
            Command::AppendMemory {
                workspace_id,
                visibility,
                body,
                owner_actor_id,
            } => {
                let owner = owner_actor_id.unwrap_or_else(|| actor.id().to_string());
                if visibility == "agent_private" {
                    match &actor {
                        Actor::Agent { id, .. } if *id == owner => {}
                        Actor::Daemon => {}
                        _ => {
                            return Err(CoordyError::denied(
                                "only the owning agent may write private memory",
                            ))
                        }
                    }
                }
                if visibility == "principal" {
                    let principal_ok = match &actor {
                        Actor::Principal { id } => {
                            *id == owner || world.agents_of(id).iter().any(|a| a.id == owner)
                        }
                        Actor::Agent { principal_id, .. } => {
                            *principal_id == owner || actor.id() == owner
                        }
                        Actor::Daemon => true,
                    };
                    if !principal_ok {
                        return Err(CoordyError::denied(
                            "cannot write another principal's memory",
                        ));
                    }
                }
                if visibility == "shared" {
                    return Err(CoordyError::denied(
                        "shared memory must be published then accepted, not appended directly",
                    ));
                }
                let id = ids::new("mem");
                world.memories.push(MemoryRecord {
                    id: id.clone(),
                    workspace_id,
                    visibility,
                    owner_actor_id: owner,
                    body,
                    status: "active".into(),
                    share_to: None,
                    source_id: None,
                });
                Ok(Outcome::ok("memory appended", json!({ "memory_id": id })))
            }
            Command::PublishMemory { memory_id } => {
                let (copy, workspace_id) = {
                    let mem = world
                        .memory(&memory_id)
                        .cloned()
                        .ok_or_else(|| CoordyError::not_found("memory"))?;
                    if mem.visibility != "agent_private" {
                        return Err(CoordyError::invalid("only private memory can be published"));
                    }
                    let allowed = match &actor {
                        Actor::Agent { id, .. } => *id == mem.owner_actor_id,
                        Actor::Principal { id } => world
                            .agent(&mem.owner_actor_id)
                            .is_some_and(|a| a.principal_id == *id),
                        Actor::Daemon => true,
                    };
                    if !allowed {
                        return Err(CoordyError::denied(
                            "publish requires authority over the memory",
                        ));
                    }
                    let principal_id = world
                        .agent(&mem.owner_actor_id)
                        .map(|a| a.principal_id.clone())
                        .ok_or_else(|| {
                            CoordyError::invalid("private memory owner is not an agent")
                        })?;
                    let mut published = mem.clone();
                    published.id = ids::new("mem");
                    published.visibility = "principal".into();
                    published.owner_actor_id = principal_id;
                    published.status = "published".into();
                    published.source_id = Some(mem.id.clone());
                    (published, mem.workspace_id)
                };
                let id = copy.id.clone();
                world.memories.push(copy);
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "published to principal memory",
                    json!({ "memory_id": id }),
                ))
            }
            Command::ShareMemory {
                memory_id,
                to_principal_id,
            } => {
                let mem = world
                    .memory(&memory_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("memory"))?;
                if mem.visibility != "principal" {
                    return Err(CoordyError::invalid("only principal memory can be shared"));
                }
                let allowed = match &actor {
                    Actor::Principal { id } => *id == mem.owner_actor_id,
                    Actor::Daemon => true,
                    _ => false,
                };
                if !allowed {
                    return Err(CoordyError::denied("only the owning principal may share"));
                }
                if world.principal(&to_principal_id).is_none() {
                    return Err(CoordyError::not_found("target principal"));
                }
                let id = ids::new("mem");
                world.memories.push(MemoryRecord {
                    id: id.clone(),
                    workspace_id: mem.workspace_id,
                    visibility: "shared".into(),
                    owner_actor_id: mem.owner_actor_id,
                    body: mem.body,
                    status: "proposed_share".into(),
                    share_to: Some(to_principal_id),
                    source_id: Some(memory_id),
                });
                Ok(Outcome::ok("share proposed", json!({ "memory_id": id })))
            }
            Command::AcceptShare { memory_id } => {
                let mem = world
                    .memory_mut(&memory_id)
                    .ok_or_else(|| CoordyError::not_found("memory"))?;
                if mem.status != "proposed_share" {
                    return Err(CoordyError::invalid("not a pending share"));
                }
                let allowed = match &actor {
                    Actor::Principal { id } => mem.share_to.as_deref() == Some(id.as_str()),
                    Actor::Daemon => true,
                    _ => false,
                };
                if !allowed {
                    return Err(CoordyError::denied("only the recipient may accept"));
                }
                mem.status = "shared".into();
                Ok(Outcome::ok(
                    "share accepted",
                    json!({ "memory_id": memory_id }),
                ))
            }
            Command::ProposeContract {
                workspace_id,
                title,
                body,
                participant_ids,
            } => {
                if !matches!(actor, Actor::Principal { .. } | Actor::Daemon) {
                    return Err(CoordyError::denied(
                        "only a principal may propose a shared contract",
                    ));
                }
                if participant_ids.len() < 2 {
                    return Err(CoordyError::invalid(
                        "shared contract needs at least two principals",
                    ));
                }
                let id = ids::new("ctr");
                world.contracts.push(Contract {
                    id: id.clone(),
                    workspace_id,
                    title,
                    body,
                    status: "proposed".into(),
                    participant_ids,
                    approvals: vec![],
                });
                Ok(Outcome::ok(
                    "contract proposed",
                    json!({ "contract_id": id }),
                ))
            }
            Command::ApproveContract { contract_id } => {
                let principal_id = match &actor {
                    Actor::Principal { id } => id.clone(),
                    Actor::Daemon => {
                        return Err(CoordyError::denied("daemon cannot approve contracts"));
                    }
                    Actor::Agent { .. } => {
                        return Err(CoordyError::denied("agent cannot approve shared contracts"));
                    }
                };
                let contract = world
                    .contracts
                    .iter_mut()
                    .find(|c| c.id == contract_id)
                    .ok_or_else(|| CoordyError::not_found("contract"))?;
                if !contract.participant_ids.contains(&principal_id) {
                    return Err(CoordyError::denied("not a contract participant"));
                }
                if !contract.approvals.contains(&principal_id) {
                    contract.approvals.push(principal_id);
                }
                if contract
                    .participant_ids
                    .iter()
                    .all(|p| contract.approvals.contains(p))
                {
                    contract.status = "active".into();
                }
                Ok(Outcome::ok(
                    "approval recorded",
                    json!({ "status": contract.status, "contract_id": contract_id }),
                ))
            }
            Command::StartRun {
                task_id,
                source,
                agent_id: override_agent,
                chat_id,
                trigger,
            } => {
                let task = world
                    .task(&task_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                if task.status == "backlog" {
                    return Err(CoordyError::invalid("backlog issues are not queued"));
                }
                let agent_id = override_agent
                    .filter(|id| !id.is_empty())
                    .or(task.assignee_agent_id.clone())
                    .ok_or_else(|| CoordyError::invalid("assign an agent first"))?;
                if !can_command_agent(&world, &actor, &agent_id) {
                    return Err(CoordyError::denied("cannot command this agent"));
                }
                let agent = world
                    .agent(&agent_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("agent"))?;
                let mut instructions = agent.instructions.clone();
                if let Some(ws) = world.workspace(&task.workspace_id) {
                    if !ws.context.is_empty() {
                        instructions = format!("# Workspace\n{}\n\n{}", ws.context, instructions);
                    }
                }
                for skill_id in &agent.skill_ids {
                    if let Some(skill) = world.skill(skill_id) {
                        instructions.push_str("\n\n# Skill: ");
                        instructions.push_str(&skill.name);
                        instructions.push('\n');
                        instructions.push_str(&skill.body);
                    }
                }
                let source = apply_agent_instructions(source, &instructions);
                let run_id = ids::new("run");
                let harness: String = match &source {
                    RunSource::Jsonl { .. } | RunSource::Fixture { .. } => "jsonl".into(),
                    RunSource::Codex { .. } => "codex".into(),
                    RunSource::ClaudeCode { .. } => "claude_code".into(),
                    RunSource::OpenCode { .. } => "opencode".into(),
                    RunSource::Acp { .. } => {
                        let h = agent.harness.trim();
                        if h.is_empty() || h == "jsonl" {
                            "acp".into()
                        } else {
                            h.to_string()
                        }
                    }
                };
                let prompt_event = match &source {
                    RunSource::Codex { prompt }
                    | RunSource::ClaudeCode { prompt }
                    | RunSource::OpenCode { prompt }
                    | RunSource::Acp { prompt } => Some(prompt.clone()),
                    RunSource::Jsonl { .. } | RunSource::Fixture { .. } => None,
                };
                world.runs.push(Run {
                    id: run_id.clone(),
                    workspace_id: task.workspace_id.clone(),
                    task_id: task_id.clone(),
                    agent_id,
                    status: "running".into(),
                    harness: harness.clone(),
                    compaction_count: 0,
                    after_compaction: false,
                    queue_status: "dispatched".into(),
                    retry_count: 0,
                    chat_id: chat_id.clone(),
                    trigger: if trigger.is_empty() { "issue".into() } else { trigger },
                    prompt: prompt_event.clone().unwrap_or_default(),
                });
                if let Some(prompt) = prompt_event {
                    ingest_event(
                        &mut world,
                        &self.advisor,
                        &run_id,
                        HarnessEvent::Message {
                            role: "user".into(),
                            content: prompt,
                        },
                    )?;
                }
                let events = match source {
                    RunSource::Fixture { events } => events,
                    RunSource::Jsonl { path } => {
                        drop(world);
                        let events = self.ports.read_jsonl(&path)?;
                        world = self.world.lock().expect("world lock");
                        events
                    }
                    RunSource::Codex { prompt }
                    | RunSource::ClaudeCode { prompt }
                    | RunSource::OpenCode { prompt }
                    | RunSource::Acp { prompt } => {
                        let worktree = task
                            .worktree_path
                            .clone()
                            .filter(|path| !path.is_empty())
                            .or_else(|| {
                                world
                                    .workspace(&task.workspace_id)
                                    .and_then(|ws| ws.repo_path.clone())
                                    .filter(|path| !path.is_empty())
                            })
                            .unwrap_or_else(|| ".".into());
                        drop(world);
                        self.ports
                            .spawn_harness(&harness, &worktree, &prompt, &run_id)?;
                        return Ok(Outcome::ok("harness started", json!({ "run_id": run_id })));
                    }
                };
                for event in events {
                    ingest_event(&mut world, &self.advisor, &run_id, event)?;
                }
                if let Some(run) = world.run_mut(&run_id) {
                    if run.status == "running" {
                        run.status = "completed".into();
                    }
                }
                Ok(Outcome::ok("run completed", json!({ "run_id": run_id })))
            }
            Command::CancelRun { run_id } => {
                let run = world
                    .run(&run_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("run"))?;
                if !can_command_agent(&world, &actor, &run.agent_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("cannot cancel this run"));
                }
                if run.status != "running" && run.status != "paused" {
                    return Err(CoordyError::invalid("this round is not running"));
                }
                if let Some(active) = world.run_mut(&run_id) {
                    active.status = "cancelled".into();
                    active.queue_status = "cancelled".into();
                }
                ingest_event(
                    &mut world,
                    &self.advisor,
                    &run_id,
                    HarnessEvent::Message {
                        role: "system".into(),
                        content: "这一轮已停下".into(),
                    },
                )?;
                drop(world);
                self.ports.cancel_harness(&run_id)?;
                Ok(Outcome::ok("run cancelled", json!({ "run_id": run_id })))
            }
            Command::IngestHarnessEvent { run_id, event } => {
                let run = world
                    .run(&run_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("run"))?;
                if !can_command_agent(&world, &actor, &run.agent_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("cannot ingest into this run"));
                }
                ingest_event(&mut world, &self.advisor, &run_id, event)?;
                Ok(Outcome::ok("ingested", json!({ "run_id": run_id })))
            }
            Command::ApplyPatch { task_id, patch } => {
                let task = world
                    .task(&task_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                if let Some(agent_id) = &task.assignee_agent_id {
                    if !can_command_agent(&world, &actor, agent_id) {
                        return Err(CoordyError::denied("cannot command this agent"));
                    }
                }
                if let Some(reason) = &task.blocked_reason {
                    return Ok(Outcome::blocked(reason.clone()));
                }
                let active: Vec<Commitment> = world
                    .commitments
                    .iter()
                    .filter(|c| {
                        c.task_id.as_deref() == Some(task_id.as_str()) && c.status == "ACTIVE"
                    })
                    .cloned()
                    .collect();
                if let Some(reason) = action_conflicts(&active, &patch) {
                    push_inbox(
                        &mut world,
                        &task.workspace_id,
                        "action_gate",
                        "Apply blocked",
                        &reason,
                        Some(task_id.clone()),
                    );
                    return Ok(Outcome::blocked(reason));
                }
                let run_paused = world
                    .runs
                    .iter()
                    .any(|r| r.task_id == task_id && world.paused_runs.contains(&r.id));
                if run_paused {
                    return Ok(Outcome::blocked("run is paused after compaction drift"));
                }
                let worktree = task
                    .worktree_path
                    .clone()
                    .ok_or_else(|| CoordyError::invalid("create a worktree first"))?;
                drop(world);
                self.ports.apply_patch(&worktree, &patch)?;
                let mut world = self.world.lock().expect("world lock");
                invalidate_dependencies(&mut world, "repo", &task_id);
                Ok(Outcome::ok("patch applied", json!({ "task_id": task_id })))
            }
            Command::DeclareDependency {
                workspace_id,
                from_id,
                to_id,
                entity,
            } => {
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                let id = ids::new("dep");
                world.dependencies.push(crate::world::DependencyEdge {
                    id: id.clone(),
                    workspace_id: workspace_id.clone(),
                    from_id,
                    to_id,
                    entity,
                    valid: true,
                });
                Self::emit(&mut world, Effect::StateChanged { workspace_id });
                Ok(Outcome::ok(
                    "dependency recorded",
                    json!({ "dependency_id": id }),
                ))
            }
            Command::SetSettings {
                workspace_id,
                llm_advisor_enabled,
            } => {
                if !matches!(actor, Actor::Principal { .. } | Actor::Daemon) {
                    return Err(CoordyError::denied("only a principal may change settings"));
                }
                if !actor_in_workspace(&world, &actor, &workspace_id)
                    && !matches!(actor, Actor::Daemon)
                {
                    return Err(CoordyError::denied("not in workspace"));
                }
                world.llm_advisor_enabled = llm_advisor_enabled;
                Self::audit(
                    &mut world,
                    &actor,
                    "set_settings",
                    &format!("llm_advisor_enabled={llm_advisor_enabled}"),
                );
                Ok(Outcome::ok(
                    "settings updated",
                    json!({ "llm_advisor_enabled": llm_advisor_enabled }),
                ))
            }
            Command::DismissInbox { item_id } => {
                let Some(item) = world.inbox.iter_mut().find(|i| i.id == item_id) else {
                    return Err(CoordyError::not_found("inbox item"));
                };
                item.dismissed = true;
                item.read = true;
                Ok(Outcome::ok("dismissed", json!({ "item_id": item_id })))
            }
            other => product::submit(&mut world, &actor, other),
        }
    }

    pub fn view_sync(&self, envelope: AuthorizedQuery) -> Result<View, CoordyError> {
        let mut world = self.world.lock().expect("world lock");
        let actor = envelope.actor;
        match envelope.query {
            Query::Health => Ok(View::Health(health_view(&world))),
            Query::Workspaces => Ok(View::Workspaces {
                items: world
                    .workspaces
                    .iter()
                    .filter(|w| !w.archived)
                    .map(product::workspace_view)
                    .collect(),
            }),
            Query::Workspace { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                let ws = world
                    .workspace(&workspace_id)
                    .ok_or_else(|| CoordyError::not_found("workspace"))?;
                Ok(View::Workspace(product::workspace_view(ws)))
            },
            Query::Board { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                let pending: Vec<String> = world
                    .tasks
                    .iter()
                    .filter(|t| t.workspace_id == workspace_id && (t.number == 0 || t.identifier.is_empty()))
                    .map(|t| t.id.clone())
                    .collect();
                for task_id in pending {
                    product::backfill_task_identity(&mut world, &task_id);
                }
                Ok(View::Board {
                    tasks: world
                        .tasks
                        .iter()
                        .filter(|t| t.workspace_id == workspace_id && !t.deleted && t.stage != "chat")
                        .map(|t| product::task_view(&world, t, &actor))
                        .collect(),
                })
            }
            Query::Commitments { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Commitments {
                    items: world
                        .commitments
                        .iter()
                        .filter(|c| c.workspace_id == workspace_id)
                        .map(|c| CommitmentView {
                            id: c.id.clone(),
                            workspace_id: c.workspace_id.clone(),
                            task_id: c.task_id.clone(),
                            commitment_type: c.commitment_type.clone(),
                            claim: c.claim.clone(),
                            polarity: c.polarity.clone(),
                            authority: c.authority.clone(),
                            status: c.status.clone(),
                        })
                        .collect(),
                })
            }
            Query::Principals { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Principals {
                    items: world
                        .principals
                        .iter()
                        .filter(|p| p.workspace_id == workspace_id)
                        .map(|p| PrincipalView {
                            id: p.id.clone(),
                            workspace_id: p.workspace_id.clone(),
                            name: p.name.clone(),
                            role: if p.role.is_empty() { "member".into() } else { p.role.clone() },
                        })
                        .collect(),
                })
            }
            Query::Agents { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Agents {
                    items: world
                        .agents
                        .iter()
                        .filter(|a| a.workspace_id == workspace_id && !a.archived)
                        .map(|a| AgentView {
                            id: a.id.clone(),
                            workspace_id: a.workspace_id.clone(),
                            principal_id: a.principal_id.clone(),
                            name: a.name.clone(),
                            harness: a.harness.clone(),
                            description: a.description.clone(),
                            instructions: a.instructions.clone(),
                            avatar: a.avatar.clone(),
                            model: a.model.clone(),
                            thinking: a.thinking.clone(),
                            speed: a.speed.clone(),
                            access: if a.access.is_empty() { "owner".into() } else { a.access.clone() },
                            access_member_ids: a.access_member_ids.clone(),
                            concurrency_limit: if a.concurrency_limit == 0 { 6 } else { a.concurrency_limit },
                            cli_args: a.cli_args.clone(),
                            mcp_servers: a.mcp_servers.clone(),
                            skill_ids: a.skill_ids.clone(),
                        })
                        .collect(),
                })
            }
            Query::Authority { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Authority {
                    grants: world
                        .grants
                        .iter()
                        .filter(|g| g.workspace_id == workspace_id)
                        .map(|g| GrantView {
                            id: g.id.clone(),
                            grantor_id: g.grantor_id.clone(),
                            grantee_id: g.grantee_id.clone(),
                            resource: g.resource.clone(),
                            action: g.action.clone(),
                            delegated: g.delegated,
                            revoked: g.revoked,
                        })
                        .collect(),
                })
            }
            Query::Memory { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                let items = world
                    .memories
                    .iter()
                    .filter(|m| m.workspace_id == workspace_id)
                    .filter(|m| memory::can_read(&world, &actor, m))
                    .map(memory_view)
                    .collect();
                Ok(View::Memory { items })
            }
            Query::Contracts { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Contracts {
                    items: world
                        .contracts
                        .iter()
                        .filter(|c| c.workspace_id == workspace_id)
                        .map(|c| ContractView {
                            id: c.id.clone(),
                            title: c.title.clone(),
                            body: c.body.clone(),
                            status: c.status.clone(),
                            participant_ids: c.participant_ids.clone(),
                            approvals: c.approvals.clone(),
                        })
                        .collect(),
                })
            }
            Query::Dependencies { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Dependencies {
                    items: world
                        .dependencies
                        .iter()
                        .filter(|d| d.workspace_id == workspace_id)
                        .map(|d| DependencyView {
                            id: d.id.clone(),
                            from_id: d.from_id.clone(),
                            to_id: d.to_id.clone(),
                            entity: d.entity.clone(),
                            valid: d.valid,
                        })
                        .collect(),
                })
            }
            Query::Conflicts { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Conflicts {
                    items: world
                        .conflicts
                        .iter()
                        .filter(|c| c.workspace_id == workspace_id)
                        .map(|c| ConflictView {
                            id: c.id.clone(),
                            summary: c.summary.clone(),
                            status: c.status.clone(),
                        })
                        .collect(),
                })
            }
            Query::Runs { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Runs {
                    items: world
                        .runs
                        .iter()
                        .filter(|r| r.workspace_id == workspace_id)
                        .map(run_view)
                        .collect(),
                })
            }
            Query::Run { run_id } => {
                let run = world
                    .run(&run_id)
                    .ok_or_else(|| CoordyError::not_found("run"))?;
                require_member(&world, &actor, &run.workspace_id)?;
                let events = world
                    .run_events
                    .iter()
                    .filter(|e| e.run_id == run_id)
                    .map(|e| RunEventView {
                        seq: e.seq,
                        kind: e.kind.clone(),
                        payload: e.payload.clone(),
                    })
                    .collect();
                Ok(View::Run {
                    run: run_view(run),
                    events,
                })
            }
            Query::Inbox { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Inbox {
                    items: world
                        .inbox
                        .iter()
                        .filter(|i| i.workspace_id == workspace_id && !i.dismissed && !i.archived)
                        .map(|i| InboxView {
                            id: i.id.clone(),
                            kind: i.kind.clone(),
                            title: i.title.clone(),
                            body: i.body.clone(),
                            related_id: i.related_id.clone(),
                            read: i.read,
                            archived: i.archived,
                        })
                        .collect(),
                })
            }
            Query::Settings { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                let repo_path = world
                    .workspace(&workspace_id)
                    .and_then(|w| w.repo_path.clone());
                Ok(View::Settings {
                    daemon: health_view(&world),
                    repo_path,
                    llm_advisor_enabled: world.llm_advisor_enabled,
                    notification_kinds: world.notification_kinds.clone(),
                })
            }
            Query::AgentContext { agent_id } => {
                let agent = world
                    .agent(&agent_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("agent"))?;
                let ctx_actor = Actor::Agent {
                    id: agent.id.clone(),
                    principal_id: agent.principal_id.clone(),
                };
                let memory = world
                    .memories
                    .iter()
                    .filter(|m| m.workspace_id == agent.workspace_id)
                    .filter(|m| memory::can_read(&world, &ctx_actor, m))
                    .map(memory_view)
                    .collect();
                let commitments = world
                    .commitments
                    .iter()
                    .filter(|c| c.workspace_id == agent.workspace_id && c.status == "ACTIVE")
                    .map(|c| c.claim.clone())
                    .collect();
                Ok(View::AgentContext {
                    context: AgentContextView {
                        agent_id,
                        commitments,
                        memory,
                    },
                })
            }
            Query::Projects { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Projects {
                    items: world
                        .projects
                        .iter()
                        .filter(|p| p.workspace_id == workspace_id)
                        .map(|p| product::project_view(p, &world))
                        .collect(),
                })
            }
            Query::Squads { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Squads {
                    items: world
                        .squads
                        .iter()
                        .filter(|s| s.workspace_id == workspace_id)
                        .map(product::squad_view)
                        .collect(),
                })
            }
            Query::Skills { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Skills {
                    items: world
                        .skills
                        .iter()
                        .filter(|s| s.workspace_id == workspace_id)
                        .map(product::skill_view)
                        .collect(),
                })
            }
            Query::Automations { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Automations {
                    items: world
                        .automations
                        .iter()
                        .filter(|a| a.workspace_id == workspace_id)
                        .map(product::automation_view)
                        .collect(),
                })
            }
            Query::Comments { task_id } => {
                let task = world
                    .task(&task_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("task"))?;
                require_member(&world, &actor, &task.workspace_id)?;
                Ok(View::Comments {
                    items: world
                        .comments
                        .iter()
                        .filter(|c| c.task_id == task_id)
                        .map(|c| product::comment_view(c, &world))
                        .collect(),
                })
            }
            Query::Chats { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Chats {
                    items: world
                        .chats
                        .iter()
                        .filter(|c| c.workspace_id == workspace_id && product::can_see_chat(&actor, c))
                        .map(product::chat_view)
                        .collect(),
                })
            }
            Query::Chat { chat_id } => {
                let chat = world
                    .chat(&chat_id)
                    .cloned()
                    .ok_or_else(|| CoordyError::not_found("chat"))?;
                if !product::can_see_chat(&actor, &chat) {
                    return Err(CoordyError::denied("private chat"));
                }
                Ok(View::Chat {
                    chat: product::chat_view(&chat),
                    messages: world
                        .chat_messages
                        .iter()
                        .filter(|m| m.chat_id == chat_id)
                        .map(product::chat_message_view)
                        .collect(),
                })
            }
            Query::Labels { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Labels {
                    items: world
                        .labels
                        .iter()
                        .filter(|l| l.workspace_id == workspace_id)
                        .map(product::label_view)
                        .collect(),
                })
            }
            Query::Stats { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Stats {
                    stats: product::stats_view(&world, &workspace_id),
                })
            }
            Query::Computers { workspace_id } => {
                require_member(&world, &actor, &workspace_id)?;
                Ok(View::Computers {
                    items: world
                        .computers
                        .iter()
                        .filter(|c| c.workspace_id == workspace_id)
                        .map(product::computer_view)
                        .collect(),
                })
            }
            Query::Account => Ok(View::Account {
                account: product::account_view(&world, &actor)?,
            }),
        }
    }
}

const SUPERSEDING_AUTHORITY: &[&str] = &["USER", "SPEC", "REPOSITORY_FACT", "AUTHORIZED_DECISION"];

fn allowed_task_status(status: &str) -> bool {
    matches!(
        status,
        "backlog" | "open" | "running" | "review" | "blocked" | "done" | "cancelled"
    )
}

fn health_view(world: &World) -> HealthView {
    HealthView {
        status: "ok".into(),
        version: PRODUCT_VERSION.into(),
        protocol_version: PROTOCOL_VERSION.into(),
        pid: std::process::id(),
        workspace_count: world.workspaces.len(),
    }
}

fn require_member(world: &World, actor: &Actor, workspace_id: &str) -> Result<(), CoordyError> {
    if matches!(actor, Actor::Daemon) {
        return Ok(());
    }
    if actor_in_workspace(world, actor, workspace_id) {
        return Ok(());
    }
    Err(CoordyError::denied("not a workspace member"))
}

fn run_view(run: &Run) -> RunView {
    RunView {
        id: run.id.clone(),
        task_id: run.task_id.clone(),
        agent_id: run.agent_id.clone(),
        status: run.status.clone(),
        harness: run.harness.clone(),
        compaction_count: run.compaction_count,
        queue_status: if run.queue_status.is_empty() {
            run.status.clone()
        } else {
            run.queue_status.clone()
        },
        retry_count: run.retry_count,
        chat_id: run.chat_id.clone(),
        trigger: run.trigger.clone(),
    }
}

fn memory_view(mem: &MemoryRecord) -> MemoryView {
    MemoryView {
        id: mem.id.clone(),
        visibility: mem.visibility.clone(),
        owner_actor_id: mem.owner_actor_id.clone(),
        body: mem.body.clone(),
        status: mem.status.clone(),
    }
}

fn push_inbox(
    world: &mut World,
    workspace_id: &str,
    kind: &str,
    title: &str,
    body: &str,
    related_id: Option<String>,
) {
                let item = InboxItem {
        id: ids::new("inb"),
        workspace_id: workspace_id.into(),
        kind: kind.into(),
        title: title.into(),
        body: body.into(),
        related_id: related_id.clone(),
        dismissed: false,
        read: false,
        archived: false,
    };
    Kernel::emit(
        world,
        Effect::InboxPosted {
            item: InboxView {
                id: item.id.clone(),
                kind: item.kind.clone(),
                title: item.title.clone(),
                body: item.body.clone(),
                related_id: item.related_id.clone(),
                read: false,
                archived: false,
            },
        },
    );
    world.inbox.push(item);
}

fn ingest_event(
    world: &mut World,
    advisor: &Arc<dyn Advisor>,
    run_id: &str,
    event: HarnessEvent,
) -> Result<(), CoordyError> {
    let run = world
        .run(run_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("run"))?;
    let seq = world
        .run_events
        .iter()
        .filter(|e| e.run_id == run_id)
        .count() as u32
        + 1;
    let (kind, payload): (String, String) = match &event {
        HarnessEvent::Message { role, content } => ("message".into(), format!("{role}: {content}")),
        HarnessEvent::Compaction { summary } => ("compaction".into(), summary.clone()),
        HarnessEvent::Tool {
            name,
            input,
            output,
            exit_code,
        } => (
            "tool".into(),
            format!("{name} in={input} out={output} exit={exit_code:?}"),
        ),
        HarnessEvent::Patch { diff } => ("patch".into(), diff.clone()),
    };
    world.run_events.push(RunEvent {
        run_id: run_id.into(),
        seq,
        kind: kind.clone(),
        payload: payload.clone(),
    });
    Kernel::emit(
        world,
        Effect::RunEvent {
            run_id: run_id.into(),
            event: RunEventView { seq, kind, payload },
        },
    );

    match event {
        HarnessEvent::Message { role, content } => {
            let authority = if role == "user" { "USER" } else { "AGENT" };
            for (kind, claim) in extract_prefixed(&content) {
                if kind == "PLAN" && run.after_compaction {
                    evaluate_drift(world, advisor, &run, &claim);
                }
                if kind != "PLAN" || !run.after_compaction {
                    maybe_record_commitment(world, &run, kind, claim, authority);
                }
            }
        }
        HarnessEvent::Compaction { .. } => {
            let claims = world
                .commitments
                .iter()
                .filter(|c| {
                    c.task_id.as_deref() == Some(run.task_id.as_str())
                        && c.status == "ACTIVE"
                        && c.commitment_type != "REJECTED_OPTION"
                })
                .map(|c| c.claim.clone())
                .collect();
            let rejected = world
                .commitments
                .iter()
                .filter(|c| {
                    c.task_id.as_deref() == Some(run.task_id.as_str())
                        && c.commitment_type == "REJECTED_OPTION"
                })
                .map(|c| c.claim.clone())
                .collect();
            world.snapshots.push(CompactionSnapshot {
                run_id: run.id.clone(),
                task_id: run.task_id.clone(),
                claims,
                rejected,
            });
            if let Some(r) = world.run_mut(run_id) {
                r.compaction_count += 1;
                r.after_compaction = true;
            }
        }
        HarnessEvent::Patch { diff } => {
            let active: Vec<Commitment> = world
                .commitments
                .iter()
                .filter(|c| {
                    c.task_id.as_deref() == Some(run.task_id.as_str()) && c.status == "ACTIVE"
                })
                .cloned()
                .collect();
            if let Some(reason) = action_conflicts(&active, &diff) {
                if let Some(task) = world.task_mut(&run.task_id) {
                    task.blocked_reason = Some(reason.clone());
                    task.status = "blocked".into();
                }
                push_inbox(
                    world,
                    &run.workspace_id,
                    "action_gate",
                    "Patch blocked",
                    &reason,
                    Some(run.task_id.clone()),
                );
            }
        }
        HarnessEvent::Tool {
            name,
            output,
            exit_code,
            ..
        } => {
                if name == coordy_protocol::HARNESS_SESSION_TOOL {
                if let Some(active) = world.run_mut(run_id) {
                    if active.status == "running" {
                        active.status = if exit_code.unwrap_or(0) == 0 {
                            "completed".into()
                        } else {
                            "failed".into()
                        };
                        active.queue_status = active.status.clone();
                    }
                }
                if exit_code.unwrap_or(0) != 0 {
                    product::push_notice(
                        world,
                        &run.workspace_id,
                        "agent_failed",
                        "智能体这一轮失败了",
                        &output,
                        Some(run.task_id.clone()),
                    );
                }
            }
            if matches!(name.as_str(), "git" | "test" | "patch_apply") {
                let paused = world.runs.iter().find(|r| r.id == run_id).cloned();
                if let Some(run) = paused {
                    if world.paused_runs.contains(&run.id) {
                        let outcomes = vec![format!("{name} exit={exit_code:?} {output}")];
                        let det = StateAssessment {
                            status: "SUSPECT".into(),
                            suspected: true,
                            diffs: vec![],
                            source: "deterministic".into(),
                        };
                        if let Some(causal) = advisor.assess_causal(&det, &outcomes) {
                            push_inbox(
                                world,
                                &run.workspace_id,
                                "causal_prelabel",
                                "Causal prelabel",
                                &format!("{}: {}", causal.prelabel, causal.reason),
                                Some(run.id.clone()),
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn maybe_record_commitment(
    world: &mut World,
    run: &Run,
    kind: String,
    claim: String,
    authority: &str,
) {
    if let Some(existing) = world.commitments.iter().find(|c| {
        c.task_id.as_deref() == Some(run.task_id.as_str())
            && c.commitment_type == kind
            && c.claim == claim
            && c.status == "ACTIVE"
    }) {
        let _ = existing;
        return;
    }
    if authority == "AGENT" {
        if let Some(old) = world.commitments.iter().find(|c| {
            c.task_id.as_deref() == Some(run.task_id.as_str())
                && c.commitment_type == kind
                && c.status == "ACTIVE"
                && SUPERSEDING_AUTHORITY.contains(&c.authority.as_str())
        }) {
            if agent_cannot_supersede(old, "AGENT") {
                return;
            }
        }
    }
    world.commitments.push(Commitment {
        id: ids::new("cmt"),
        workspace_id: run.workspace_id.clone(),
        task_id: Some(run.task_id.clone()),
        commitment_type: kind,
        claim,
        polarity: "MUST".into(),
        authority: authority.into(),
        status: "ACTIVE".into(),
        scope: run.task_id.clone(),
        owner_actor_id: run.agent_id.clone(),
        superseded_by: None,
    });
}

fn evaluate_drift(world: &mut World, advisor: &Arc<dyn Advisor>, run: &Run, working_plan: &str) {
    let Some(snapshot) = world
        .snapshots
        .iter()
        .rev()
        .find(|s| s.run_id == run.id)
        .cloned()
    else {
        return;
    };
    let det =
        deterministic_state_diff_with_rejected(&snapshot.claims, &snapshot.rejected, working_plan);
    let assessed = if world.llm_advisor_enabled {
        advisor.assess_state_diff(&snapshot.claims, working_plan, &det)
    } else {
        let mut out = det.clone();
        out.source = "deterministic".into();
        out
    };
    if assessed.suspected {
        world.paused_runs.push(run.id.clone());
        if let Some(task) = world.task_mut(&run.task_id) {
            task.blocked_reason = Some("compaction drift suspected".into());
            task.status = "blocked".into();
        }
        if let Some(r) = world.run_mut(&run.id) {
            r.status = "paused".into();
        }
        let reason = assessed
            .diffs
            .iter()
            .filter(|d| d.status != "preserved")
            .map(|d| format!("{}: {}", d.status, d.commitment))
            .collect::<Vec<_>>()
            .join("; ");
        push_inbox(
            world,
            &run.workspace_id,
            "pause",
            "Pause after compaction drift",
            &reason,
            Some(run.id.clone()),
        );
        Kernel::emit(
            world,
            Effect::Pause {
                run_id: run.id.clone(),
                reason: reason.clone(),
            },
        );
        Kernel::emit(
            world,
            Effect::Replan {
                run_id: run.id.clone(),
                reason: "replan against canonical commitments".into(),
            },
        );
        push_inbox(
            world,
            &run.workspace_id,
            "replan",
            "Replan required",
            "working plan diverged from canonical commitments",
            Some(run.task_id.clone()),
        );
        if let Some(causal) = advisor.assess_causal(&assessed, &[]) {
            push_inbox(
                world,
                &run.workspace_id,
                "causal_prelabel",
                "Causal prelabel",
                &format!("{}: {}", causal.prelabel, causal.reason),
                Some(run.id.clone()),
            );
        }
    }
}

fn normalize_agent_name(name: &str) -> Result<String, CoordyError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoordyError::invalid("agent name is required"));
    }
    Ok(name.to_string())
}

fn agent_name_taken(
    world: &World,
    workspace_id: &str,
    name: &str,
    except_id: Option<&str>,
) -> bool {
    world.agents.iter().any(|agent| {
        !agent.archived
            && agent.workspace_id == workspace_id
            && except_id.map(|id| agent.id != id).unwrap_or(true)
            && agent.name.trim() == name
    })
}

fn apply_agent_instructions(source: RunSource, instructions: &str) -> RunSource {
    let extra = instructions.trim();
    if extra.is_empty() {
        return source;
    }
    match source {
        RunSource::Acp { prompt } => RunSource::Acp {
            prompt: format!("{extra}\n\n{prompt}"),
        },
        RunSource::Codex { prompt } => RunSource::Codex {
            prompt: format!("{extra}\n\n{prompt}"),
        },
        RunSource::ClaudeCode { prompt } => RunSource::ClaudeCode {
            prompt: format!("{extra}\n\n{prompt}"),
        },
        RunSource::OpenCode { prompt } => RunSource::OpenCode {
            prompt: format!("{extra}\n\n{prompt}"),
        },
        other => other,
    }
}

pub fn shared_memory_payloads(world: &World) -> Vec<MemoryRecord> {
    world
        .memories
        .iter()
        .filter(|m| m.visibility == "shared" && m.status == "shared")
        .cloned()
        .collect()
}

pub fn sync_batch(world: &World) -> serde_json::Value {
    json!({
        "contracts": world.contracts,
        "published_memory": shared_memory_payloads(world),
        "tasks": world.tasks,
        "conflicts": world.conflicts,
    })
}
