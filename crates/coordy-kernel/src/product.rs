use coordy_protocol::{
    AccountView, Actor, AttachmentView, AutomationView, ChatMessageView, ChatView, Command, CommentView,
    ComputerView, CoordyError, Effect, InboxView, LabelView, Mention, Outcome, ProjectView, SkillView,
    SquadView, StatsView, TaskView, WorkspaceView,
};
use serde_json::json;

use crate::authority::{actor_in_workspace, can_command_agent};
use crate::ids;
use crate::world::{
    Attachment, Automation, Chat, ChatMessage, Comment, Computer, CustomPropertyDef, DirectoryLock,
    Integration, Principal, Project, Reaction, Skill, Squad, Task, TaskSubscription, Workspace,
    WorkspaceLabel, World,
};

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "workspace".into()
    } else {
        trimmed.chars().take(32).collect()
    }
}

pub fn ensure_unique_slug(world: &World, workspace_id: &str, slug: &str) -> Result<(), CoordyError> {
    if world.workspaces.iter().any(|w| w.id != workspace_id && !w.archived && w.slug == slug) {
        return Err(CoordyError::invalid("workspace slug must be unique"));
    }
    Ok(())
}

pub fn workspace_view(ws: &Workspace) -> WorkspaceView {
    WorkspaceView {
        id: ws.id.clone(),
        name: ws.name.clone(),
        repo_path: ws.repo_path.clone(),
        icon: ws.icon.clone(),
        description: ws.description.clone(),
        context: ws.context.clone(),
        slug: ws.slug.clone(),
        issue_prefix: if ws.issue_prefix.is_empty() {
            "COOR".into()
        } else {
            ws.issue_prefix.clone()
        },
        next_issue_number: if ws.next_issue_number == 0 {
            1
        } else {
            ws.next_issue_number
        },
    }
}

pub fn allocate_issue_number(world: &mut World, workspace_id: &str) -> Result<(u64, String), CoordyError> {
    let ws = world
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| CoordyError::not_found("workspace"))?;
    if ws.issue_prefix.is_empty() {
        ws.issue_prefix = "COOR".into();
    }
    if ws.next_issue_number == 0 {
        ws.next_issue_number = 1;
    }
    let number = ws.next_issue_number;
    ws.next_issue_number += 1;
    let identifier = format!("{}-{}", ws.issue_prefix, number);
    Ok((number, identifier))
}

pub fn backfill_task_identity(world: &mut World, task_id: &str) {
    let Some(task) = world.task(task_id).cloned() else {
        return;
    };
    if task.number != 0 && !task.identifier.is_empty() {
        return;
    }
    if let Ok((number, identifier)) = allocate_issue_number(world, &task.workspace_id) {
        if let Some(row) = world.task_mut(task_id) {
            if row.number == 0 {
                row.number = number;
            }
            if row.identifier.is_empty() {
                row.identifier = identifier;
            }
        }
    }
}

pub fn task_view(world: &World, task: &Task, actor: &Actor) -> TaskView {
    let subscribed = actor.principal_id().is_some_and(|pid| {
        world
            .subscriptions
            .iter()
            .any(|s| s.task_id == task.id && s.principal_id == pid)
    });
    let attachments = world
        .attachments
        .iter()
        .filter(|a| a.task_id == task.id)
        .map(|a| AttachmentView {
            id: a.id.clone(),
            name: a.name.clone(),
            path: a.path.clone(),
        })
        .collect();
    TaskView {
        id: task.id.clone(),
        workspace_id: task.workspace_id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: task.status.clone(),
        assignee_agent_id: task.assignee_agent_id.clone(),
        worktree_path: task.worktree_path.clone(),
        blocked_reason: task.blocked_reason.clone(),
        identifier: task.identifier.clone(),
        number: task.number,
        priority: if task.priority.is_empty() {
            "none".into()
        } else {
            task.priority.clone()
        },
        start_date: task.start_date.clone(),
        due_date: task.due_date.clone(),
        labels: task.labels.clone(),
        custom_fields: task.custom_fields.clone(),
        assignee_principal_id: task.assignee_principal_id.clone(),
        assignee_squad_id: task.assignee_squad_id.clone(),
        project_id: task.project_id.clone(),
        parent_id: task.parent_id.clone(),
        stage: task.stage.clone(),
        sort_key: task.sort_key,
        subscribed,
        attachments,
        pull_requests: task.pull_requests.clone(),
    }
}

pub fn require_member(world: &World, actor: &Actor, workspace_id: &str) -> Result<(), CoordyError> {
    if matches!(actor, Actor::Daemon) {
        return Ok(());
    }
    if actor_in_workspace(world, actor, workspace_id) {
        return Ok(());
    }
    Err(CoordyError::denied("not a workspace member"))
}

fn require_not_agent(actor: &Actor) -> Result<(), CoordyError> {
    if actor.is_agent() {
        return Err(CoordyError::denied("agent cannot do this"));
    }
    Ok(())
}

fn role_ok(role: &str) -> bool {
    matches!(role, "owner" | "admin" | "member")
}

pub(crate) fn priority_ok(value: &str) -> bool {
    matches!(value, "urgent" | "high" | "medium" | "low" | "none")
}

fn notify_enabled(world: &World, kind: &str) -> bool {
    if world.notification_kinds.is_empty() {
        return true;
    }
    world.notification_kinds.iter().any(|k| k == kind)
}

pub fn push_notice(
    world: &mut World,
    workspace_id: &str,
    kind: &str,
    title: &str,
    body: &str,
    related_id: Option<String>,
) {
    if !notify_enabled(world, kind) {
        return;
    }
    let item = crate::world::InboxItem {
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
    crate::runtime::Kernel::emit_effect(
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

fn emit_changed(world: &mut World, workspace_id: String) {
    crate::runtime::Kernel::emit_effect(world, Effect::StateChanged { workspace_id });
}

pub fn submit(world: &mut World, actor: &Actor, command: Command) -> Result<Outcome, CoordyError> {
    match command {
        Command::UpdateWorkspace {
            workspace_id,
            name,
            icon,
            description,
            context,
            slug,
            issue_prefix,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if let Some(slug) = slug.as_ref().map(|s| slugify(s)) {
                ensure_unique_slug(world, &workspace_id, &slug)?;
                if let Some(ws) = world.workspaces.iter_mut().find(|w| w.id == workspace_id) {
                    ws.slug = slug;
                }
            }
            let Some(ws) = world.workspaces.iter_mut().find(|w| w.id == workspace_id) else {
                return Err(CoordyError::not_found("workspace"));
            };
            if let Some(name) = name {
                if name.trim().is_empty() {
                    return Err(CoordyError::invalid("name cannot be empty"));
                }
                ws.name = name;
            }
            if let Some(icon) = icon {
                ws.icon = icon;
            }
            if let Some(description) = description {
                ws.description = description;
            }
            if let Some(context) = context {
                ws.context = context;
            }
            if let Some(prefix) = issue_prefix {
                let prefix = prefix.trim().to_uppercase();
                if prefix.is_empty() || !prefix.chars().all(|c| c.is_ascii_alphanumeric()) {
                    return Err(CoordyError::invalid("issue prefix must be alphanumeric"));
                }
                ws.issue_prefix = prefix;
            }
            emit_changed(world, workspace_id.clone());
            Ok(Outcome::ok("workspace updated", json!({ "workspace_id": workspace_id })))
        }
        Command::DeleteWorkspace { workspace_id } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let Some(ws) = world.workspaces.iter_mut().find(|w| w.id == workspace_id) else {
                return Err(CoordyError::not_found("workspace"));
            };
            ws.archived = true;
            emit_changed(world, workspace_id.clone());
            Ok(Outcome::ok("workspace deleted", json!({ "workspace_id": workspace_id })))
        }
        Command::LeaveWorkspace { workspace_id } => {
            require_not_agent(actor)?;
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("only a member can leave"));
            };
            let principal = world
                .principal(pid)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("principal"))?;
            if principal.workspace_id != workspace_id {
                return Err(CoordyError::invalid("not in this workspace"));
            }
            if principal.role == "owner"
                && world
                    .principals
                    .iter()
                    .filter(|p| p.workspace_id == workspace_id && p.role == "owner")
                    .count()
                    == 1
            {
                return Err(CoordyError::invalid("last owner cannot leave"));
            }
            world.principals.retain(|p| p.id != pid);
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("left workspace", json!({ "principal_id": pid })))
        }
        Command::InvitePrincipal {
            workspace_id,
            name,
            role,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let role = if role.is_empty() { "member".into() } else { role };
            if !role_ok(&role) {
                return Err(CoordyError::invalid("unknown role"));
            }
            let id = ids::new("pr");
            world.principals.push(Principal {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                role,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("invited", json!({ "principal_id": id })))
        }
        Command::SetPrincipalRole { principal_id, role } => {
            require_not_agent(actor)?;
            if !role_ok(&role) {
                return Err(CoordyError::invalid("unknown role"));
            }
            let principal = world
                .principal(&principal_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("principal"))?;
            require_member(world, actor, &principal.workspace_id)?;
            if let Some(row) = world.principals.iter_mut().find(|p| p.id == principal_id) {
                row.role = role.clone();
            }
            emit_changed(world, principal.workspace_id);
            Ok(Outcome::ok("role updated", json!({ "principal_id": principal_id, "role": role })))
        }
        Command::AssignIssue {
            task_id,
            agent_id,
            principal_id,
            squad_id,
            project_id,
            parent_id,
            stage,
        } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if let Some(agent_id) = agent_id.as_ref() {
                if !agent_id.is_empty() && !can_command_agent(world, actor, agent_id) {
                    return Err(CoordyError::denied("cannot command this agent"));
                }
            }
            if let Some(row) = world.task_mut(&task_id) {
                if let Some(agent_id) = agent_id {
                    row.assignee_agent_id = if agent_id.is_empty() { None } else { Some(agent_id) };
                }
                if let Some(principal_id) = principal_id {
                    row.assignee_principal_id = if principal_id.is_empty() {
                        None
                    } else {
                        Some(principal_id)
                    };
                }
                if let Some(squad_id) = squad_id {
                    row.assignee_squad_id = if squad_id.is_empty() { None } else { Some(squad_id) };
                }
                if let Some(project_id) = project_id {
                    row.project_id = if project_id.is_empty() { None } else { Some(project_id) };
                }
                if let Some(parent_id) = parent_id {
                    row.parent_id = if parent_id.is_empty() { None } else { Some(parent_id) };
                }
                if let Some(stage) = stage {
                    row.stage = stage;
                }
            }
            push_notice(
                world,
                &task.workspace_id,
                "assignment",
                "事项已指派",
                &task.title,
                Some(task_id.clone()),
            );
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("issue assigned", json!({ "task_id": task_id })))
        }
        Command::DeleteTask { task_id } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if let Some(row) = world.task_mut(&task_id) {
                row.deleted = true;
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("task deleted", json!({ "task_id": task_id })))
        }
        Command::SubscribeTask { task_id } => {
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("only a member can subscribe"));
            };
            if !world
                .subscriptions
                .iter()
                .any(|s| s.task_id == task_id && s.principal_id == pid)
            {
                world.subscriptions.push(TaskSubscription {
                    task_id: task_id.clone(),
                    principal_id: pid.to_string(),
                });
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("subscribed", json!({ "task_id": task_id })))
        }
        Command::UnsubscribeTask { task_id } => {
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("only a member can unsubscribe"));
            };
            world
                .subscriptions
                .retain(|s| !(s.task_id == task_id && s.principal_id == pid));
            Ok(Outcome::ok("unsubscribed", json!({ "task_id": task_id })))
        }
        Command::ReorderTasks {
            workspace_id,
            status,
            task_ids,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            for (index, task_id) in task_ids.iter().enumerate() {
                if let Some(task) = world.task_mut(task_id) {
                    if task.workspace_id == workspace_id {
                        task.sort_key = index as i64;
                        if !status.is_empty() {
                            task.status = status.clone();
                        }
                    }
                }
            }
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("reordered", json!({})))
        }
        Command::AddAttachment { task_id, name, path } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if name.trim().is_empty() || path.trim().is_empty() {
                return Err(CoordyError::invalid("attachment name and path required"));
            }
            let id = ids::new("att");
            world.attachments.push(Attachment {
                id: id.clone(),
                task_id: task_id.clone(),
                name,
                path,
            });
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("attached", json!({ "attachment_id": id })))
        }
        Command::RemoveAttachment { attachment_id } => {
            require_not_agent(actor)?;
            let Some(att) = world.attachments.iter().find(|a| a.id == attachment_id).cloned() else {
                return Err(CoordyError::not_found("attachment"));
            };
            let workspace_id = world.task(&att.task_id).map(|t| t.workspace_id.clone());
            world.attachments.retain(|a| a.id != attachment_id);
            if let Some(workspace_id) = workspace_id {
                emit_changed(world, workspace_id);
            }
            Ok(Outcome::ok("removed", json!({ "attachment_id": attachment_id })))
        }
        Command::ArchiveInbox { item_id } => {
            let Some(item) = world.inbox.iter_mut().find(|i| i.id == item_id) else {
                return Err(CoordyError::not_found("inbox item"));
            };
            item.archived = true;
            item.read = true;
            Ok(Outcome::ok("archived", json!({ "item_id": item_id })))
        }
        Command::SetInboxRead { item_id, read } => {
            let Some(item) = world.inbox.iter_mut().find(|i| i.id == item_id) else {
                return Err(CoordyError::not_found("inbox item"));
            };
            item.read = read;
            Ok(Outcome::ok("inbox updated", json!({ "item_id": item_id })))
        }
        Command::SetNotificationPrefs { workspace_id, kinds } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            world.notification_kinds = kinds;
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("notification prefs saved", json!({})))
        }
        Command::CreateProject {
            workspace_id,
            name,
            icon,
            description,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if name.trim().is_empty() {
                return Err(CoordyError::invalid("name cannot be empty"));
            }
            let id = ids::new("proj");
            world.projects.push(Project {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                icon,
                description,
                status: "planned".into(),
                priority: "none".into(),
                lead_id: None,
                start_date: None,
                due_date: None,
                resource: String::new(),
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("project created", json!({ "project_id": id })))
        }
        Command::UpdateProject {
            project_id,
            name,
            icon,
            description,
            status,
            priority,
            lead_id,
            start_date,
            due_date,
            resource,
        } => {
            require_not_agent(actor)?;
            let project = world
                .project(&project_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("project"))?;
            require_member(world, actor, &project.workspace_id)?;
            if let Some(row) = world.projects.iter_mut().find(|p| p.id == project_id) {
                if let Some(name) = name {
                    row.name = name;
                }
                if let Some(icon) = icon {
                    row.icon = icon;
                }
                if let Some(description) = description {
                    row.description = description;
                }
                if let Some(status) = status {
                    row.status = status;
                }
                if let Some(priority) = priority {
                    row.priority = priority;
                }
                if let Some(lead_id) = lead_id {
                    row.lead_id = if lead_id.is_empty() { None } else { Some(lead_id) };
                }
                if let Some(start_date) = start_date {
                    row.start_date = if start_date.is_empty() { None } else { Some(start_date) };
                }
                if let Some(due_date) = due_date {
                    row.due_date = if due_date.is_empty() { None } else { Some(due_date) };
                }
                if let Some(resource) = resource {
                    row.resource = resource;
                }
            }
            emit_changed(world, project.workspace_id);
            Ok(Outcome::ok("project updated", json!({ "project_id": project_id })))
        }
        Command::DeleteProject { project_id } => {
            require_not_agent(actor)?;
            let project = world
                .project(&project_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("project"))?;
            require_member(world, actor, &project.workspace_id)?;
            world.projects.retain(|p| p.id != project_id);
            for task in world.tasks.iter_mut() {
                if task.project_id.as_deref() == Some(project_id.as_str()) {
                    task.project_id = None;
                }
            }
            emit_changed(world, project.workspace_id);
            Ok(Outcome::ok("project deleted", json!({ "project_id": project_id })))
        }
        Command::CreateSquad {
            workspace_id,
            name,
            leader_agent_id,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let leader = world
                .agent(&leader_agent_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("agent"))?;
            if leader.workspace_id != workspace_id {
                return Err(CoordyError::invalid("leader workspace mismatch"));
            }
            let id = ids::new("sq");
            world.squads.push(Squad {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                leader_agent_id,
                member_agent_ids: Vec::new(),
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("squad created", json!({ "squad_id": id })))
        }
        Command::UpdateSquad {
            squad_id,
            name,
            leader_agent_id,
        } => {
            require_not_agent(actor)?;
            let squad = world
                .squad(&squad_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("squad"))?;
            require_member(world, actor, &squad.workspace_id)?;
            if let Some(row) = world.squads.iter_mut().find(|s| s.id == squad_id) {
                if let Some(name) = name {
                    row.name = name;
                }
                if let Some(leader_agent_id) = leader_agent_id {
                    row.leader_agent_id = leader_agent_id;
                }
            }
            emit_changed(world, squad.workspace_id);
            Ok(Outcome::ok("squad updated", json!({ "squad_id": squad_id })))
        }
        Command::SetSquadMembers { squad_id, agent_ids } => {
            require_not_agent(actor)?;
            let squad = world
                .squad(&squad_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("squad"))?;
            require_member(world, actor, &squad.workspace_id)?;
            if let Some(row) = world.squads.iter_mut().find(|s| s.id == squad_id) {
                row.member_agent_ids = agent_ids;
            }
            emit_changed(world, squad.workspace_id);
            Ok(Outcome::ok("squad members updated", json!({ "squad_id": squad_id })))
        }
        Command::DeleteSquad { squad_id } => {
            require_not_agent(actor)?;
            let squad = world
                .squad(&squad_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("squad"))?;
            require_member(world, actor, &squad.workspace_id)?;
            world.squads.retain(|s| s.id != squad_id);
            emit_changed(world, squad.workspace_id);
            Ok(Outcome::ok("squad deleted", json!({ "squad_id": squad_id })))
        }
        Command::CreateSkill {
            workspace_id,
            name,
            body,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let id = ids::new("sk");
            world.skills.push(Skill {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                body,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("skill created", json!({ "skill_id": id })))
        }
        Command::UpdateSkill {
            skill_id,
            name,
            body,
        } => {
            require_not_agent(actor)?;
            let skill = world
                .skill(&skill_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("skill"))?;
            require_member(world, actor, &skill.workspace_id)?;
            if let Some(row) = world.skills.iter_mut().find(|s| s.id == skill_id) {
                if let Some(name) = name {
                    row.name = name;
                }
                if let Some(body) = body {
                    row.body = body;
                }
            }
            emit_changed(world, skill.workspace_id);
            Ok(Outcome::ok("skill updated", json!({ "skill_id": skill_id })))
        }
        Command::DeleteSkill { skill_id } => {
            require_not_agent(actor)?;
            let skill = world
                .skill(&skill_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("skill"))?;
            require_member(world, actor, &skill.workspace_id)?;
            world.skills.retain(|s| s.id != skill_id);
            for agent in world.agents.iter_mut() {
                agent.skill_ids.retain(|id| id != &skill_id);
            }
            emit_changed(world, skill.workspace_id);
            Ok(Outcome::ok("skill deleted", json!({ "skill_id": skill_id })))
        }
        Command::SetAgentSkills { agent_id, skill_ids } => {
            let agent = world
                .agent(&agent_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("agent"))?;
            let allowed = match actor {
                Actor::Daemon => true,
                Actor::Principal { id } => *id == agent.principal_id,
                Actor::Agent { .. } => false,
            };
            if !allowed {
                return Err(CoordyError::denied("only the owner may bind skills"));
            }
            if let Some(row) = world.agents.iter_mut().find(|a| a.id == agent_id) {
                row.skill_ids = skill_ids;
            }
            emit_changed(world, agent.workspace_id);
            Ok(Outcome::ok("skills bound", json!({ "agent_id": agent_id })))
        }
        Command::CreateAutomation {
            workspace_id,
            name,
            runbook,
            assignee_agent_id,
            schedule,
            create_issue,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let id = ids::new("auto");
            world.automations.push(Automation {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                runbook,
                assignee_agent_id,
                schedule,
                create_issue,
                last_run_id: None,
                run_count: 0,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("automation created", json!({ "automation_id": id })))
        }
        Command::UpdateAutomation {
            automation_id,
            name,
            runbook,
            assignee_agent_id,
            schedule,
            create_issue,
        } => {
            require_not_agent(actor)?;
            let auto = world
                .automation(&automation_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("automation"))?;
            require_member(world, actor, &auto.workspace_id)?;
            if let Some(row) = world.automations.iter_mut().find(|a| a.id == automation_id) {
                if let Some(name) = name {
                    row.name = name;
                }
                if let Some(runbook) = runbook {
                    row.runbook = runbook;
                }
                if let Some(assignee_agent_id) = assignee_agent_id {
                    row.assignee_agent_id = if assignee_agent_id.is_empty() {
                        None
                    } else {
                        Some(assignee_agent_id)
                    };
                }
                if let Some(schedule) = schedule {
                    row.schedule = schedule;
                }
                if let Some(create_issue) = create_issue {
                    row.create_issue = create_issue;
                }
            }
            emit_changed(world, auto.workspace_id);
            Ok(Outcome::ok("automation updated", json!({ "automation_id": automation_id })))
        }
        Command::TriggerAutomation { automation_id } => {
            require_not_agent(actor)?;
            let auto = world
                .automation(&automation_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("automation"))?;
            require_member(world, actor, &auto.workspace_id)?;
            let mut created_task = None;
            if auto.create_issue {
                let (number, identifier) = allocate_issue_number(world, &auto.workspace_id)?;
                let task_id = ids::new("task");
                world.tasks.push(Task {
                    id: task_id.clone(),
                    workspace_id: auto.workspace_id.clone(),
                    title: auto.name.clone(),
                    description: auto.runbook.clone(),
                    status: "open".into(),
                    assignee_agent_id: auto.assignee_agent_id.clone(),
                    worktree_path: None,
                    blocked_reason: None,
                    identifier,
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
                    sort_key: world.tasks.len() as i64,
                    deleted: false,
                    pull_requests: Vec::new(),
                });
                created_task = Some(task_id);
            }
            if let Some(row) = world.automations.iter_mut().find(|a| a.id == automation_id) {
                row.run_count += 1;
            }
            push_notice(
                world,
                &auto.workspace_id,
                "automation",
                "自动化已运行",
                &auto.name,
                created_task.clone(),
            );
            emit_changed(world, auto.workspace_id);
            Ok(Outcome::ok(
                "automation triggered",
                json!({ "automation_id": automation_id, "task_id": created_task }),
            ))
        }
        Command::DeleteAutomation { automation_id } => {
            require_not_agent(actor)?;
            let auto = world
                .automation(&automation_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("automation"))?;
            require_member(world, actor, &auto.workspace_id)?;
            world.automations.retain(|a| a.id != automation_id);
            emit_changed(world, auto.workspace_id);
            Ok(Outcome::ok("automation deleted", json!({ "automation_id": automation_id })))
        }
        Command::AddComment {
            task_id,
            body,
            parent_id,
            mentions,
        } => {
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if body.trim().is_empty() {
                return Err(CoordyError::invalid("comment cannot be empty"));
            }
            let mentions = if mentions.is_empty() {
                mentions_from_body(&body)
            } else {
                mentions
            };
            let id = ids::new("cmtxt");
            world.comments.push(Comment {
                id: id.clone(),
                workspace_id: task.workspace_id.clone(),
                task_id: task_id.clone(),
                author_id: actor.id().to_string(),
                body: body.clone(),
                parent_id,
                resolved: false,
                conclusion: false,
                mentions: mentions.clone(),
            });
            push_notice(
                world,
                &task.workspace_id,
                "comment",
                "新评论",
                &body,
                Some(task_id.clone()),
            );
            for mention in &mentions {
                if mention.kind == "principal" || mention.kind == "all" {
                    push_notice(
                        world,
                        &task.workspace_id,
                        "mention",
                        "有人提到了你",
                        &body,
                        Some(task_id.clone()),
                    );
                }
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("comment added", json!({ "comment_id": id })))
        }
        Command::ResolveComment { comment_id, resolved } => {
            require_not_agent(actor)?;
            let comment = world
                .comment(&comment_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("comment"))?;
            require_member(world, actor, &comment.workspace_id)?;
            if let Some(row) = world.comments.iter_mut().find(|c| c.id == comment_id) {
                row.resolved = resolved;
            }
            emit_changed(world, comment.workspace_id);
            Ok(Outcome::ok("comment resolved", json!({ "comment_id": comment_id })))
        }
        Command::SetCommentConclusion { comment_id } => {
            require_not_agent(actor)?;
            let comment = world
                .comment(&comment_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("comment"))?;
            require_member(world, actor, &comment.workspace_id)?;
            for row in world.comments.iter_mut().filter(|c| c.task_id == comment.task_id) {
                row.conclusion = row.id == comment_id;
            }
            emit_changed(world, comment.workspace_id);
            Ok(Outcome::ok("conclusion set", json!({ "comment_id": comment_id })))
        }
        Command::AddReaction { target_id, emoji } => {
            if emoji.trim().is_empty() {
                return Err(CoordyError::invalid("emoji required"));
            }
            world.reactions.push(Reaction {
                target_id: target_id.clone(),
                actor_id: actor.id().to_string(),
                emoji,
            });
            Ok(Outcome::ok("reacted", json!({ "target_id": target_id })))
        }
        Command::CreateChat {
            workspace_id,
            agent_id,
            project_id,
        } => {
            require_member(world, actor, &workspace_id)?;
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("only a member can start a private chat"));
            };
            let agent = world
                .agent(&agent_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("agent"))?;
            if agent.workspace_id != workspace_id {
                return Err(CoordyError::invalid("agent workspace mismatch"));
            }
            let id = ids::new("chat");
            let (number, identifier) = allocate_issue_number(world, &workspace_id)?;
            let task_id = ids::new("task");
            world.tasks.push(Task {
                id: task_id.clone(),
                workspace_id: workspace_id.clone(),
                title: format!("对话 · {}", agent.name),
                description: String::new(),
                status: "backlog".into(),
                assignee_agent_id: Some(agent_id.clone()),
                worktree_path: None,
                blocked_reason: None,
                identifier,
                number,
                priority: "none".into(),
                start_date: None,
                due_date: None,
                labels: vec!["chat".into()],
                custom_fields: Vec::new(),
                assignee_principal_id: Some(pid.to_string()),
                assignee_squad_id: None,
                project_id: project_id.clone(),
                parent_id: None,
                stage: "chat".into(),
                sort_key: world.tasks.len() as i64,
                deleted: false,
                pull_requests: Vec::new(),
            });
            world.chats.push(Chat {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                agent_id,
                owner_principal_id: pid.to_string(),
                project_id,
                archived: false,
                title: agent.name,
                task_id: Some(task_id),
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("chat created", json!({ "chat_id": id })))
        }
        Command::SendChatMessage { chat_id, body } => {
            let chat = world
                .chat(&chat_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("chat"))?;
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("private chat"));
            };
            if chat.owner_principal_id != pid && !matches!(actor, Actor::Daemon) {
                return Err(CoordyError::denied("private chat"));
            }
            if body.trim().is_empty() {
                return Err(CoordyError::invalid("message cannot be empty"));
            }
            let id = ids::new("msg");
            world.chat_messages.push(ChatMessage {
                id: id.clone(),
                chat_id: chat_id.clone(),
                role: "user".into(),
                body,
                run_id: None,
            });
            emit_changed(world, chat.workspace_id);
            Ok(Outcome::ok("message sent", json!({ "message_id": id, "chat_id": chat_id })))
        }
        Command::StopChat { chat_id } => {
            let chat = world
                .chat(&chat_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("chat"))?;
            for run in world.runs.iter_mut().filter(|r| r.chat_id.as_deref() == Some(chat_id.as_str()) && r.status == "running") {
                run.status = "cancelled".into();
            }
            emit_changed(world, chat.workspace_id);
            Ok(Outcome::ok("chat stopped", json!({ "chat_id": chat_id })))
        }
        Command::ArchiveChat { chat_id } => {
            let chat = world
                .chat(&chat_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("chat"))?;
            let Some(pid) = actor.principal_id() else {
                return Err(CoordyError::denied("private chat"));
            };
            if chat.owner_principal_id != pid && !matches!(actor, Actor::Daemon) {
                return Err(CoordyError::denied("private chat"));
            }
            if let Some(row) = world.chats.iter_mut().find(|c| c.id == chat_id) {
                row.archived = true;
            }
            emit_changed(world, chat.workspace_id);
            Ok(Outcome::ok("chat archived", json!({ "chat_id": chat_id })))
        }
        Command::StartMentionRun {
            task_id,
            agent_id,
            prompt: _,
        } => {
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if task.status == "backlog" {
                return Err(CoordyError::invalid("backlog issues are not queued"));
            }
            if !can_command_agent(world, actor, &agent_id) {
                return Err(CoordyError::denied("cannot command this agent"));
            }
            Ok(Outcome::ok(
                "mention accepted",
                json!({ "task_id": task_id, "agent_id": agent_id }),
            ))
        }
        Command::RetryRun { run_id } => {
            let run = world
                .run(&run_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("run"))?;
            if !can_command_agent(world, actor, &run.agent_id) && !matches!(actor, Actor::Daemon) {
                return Err(CoordyError::denied("cannot retry this run"));
            }
            if let Some(row) = world.run_mut(&run_id) {
                row.retry_count += 1;
                row.status = "queued".into();
                row.queue_status = "queued".into();
            }
            emit_changed(world, run.workspace_id);
            Ok(Outcome::ok("run retried", json!({ "run_id": run_id })))
        }
        Command::SetDirectoryLock {
            workspace_id,
            path,
            locked,
        } => {
            require_member(world, actor, &workspace_id)?;
            if locked {
                if world
                    .directory_locks
                    .iter()
                    .any(|l| l.workspace_id == workspace_id && l.path == path)
                {
                    return Err(CoordyError::invalid("directory already locked"));
                }
                world.directory_locks.push(DirectoryLock {
                    workspace_id: workspace_id.clone(),
                    path,
                    holder_run_id: None,
                });
            } else {
                world
                    .directory_locks
                    .retain(|l| !(l.workspace_id == workspace_id && l.path == path));
            }
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("lock updated", json!({})))
        }
        Command::RegisterComputer {
            workspace_id,
            name,
            kind,
            concurrency_limit,
        } => {
            require_member(world, actor, &workspace_id)?;
            let id = ids::new("pc");
            let kind = if kind.is_empty() { "local".into() } else { kind };
            let concurrency_limit = if concurrency_limit == 0 { 20 } else { concurrency_limit };
            world.computers.push(Computer {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                kind,
                online: true,
                concurrency_limit,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("computer registered", json!({ "computer_id": id })))
        }
        Command::DuplicateAgent { agent_id } => {
            let agent = world
                .agent(&agent_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("agent"))?;
            let allowed = match actor {
                Actor::Daemon => true,
                Actor::Principal { id } => *id == agent.principal_id,
                Actor::Agent { .. } => false,
            };
            if !allowed {
                return Err(CoordyError::denied("only the owner may duplicate this agent"));
            }
            let id = ids::new("ag");
            let mut copy = agent.clone();
            copy.id = id.clone();
            copy.name = format!("{} 副本", agent.name);
            copy.archived = false;
            world.agents.push(copy);
            emit_changed(world, agent.workspace_id);
            Ok(Outcome::ok("agent duplicated", json!({ "agent_id": id })))
        }
        Command::CreateLabel {
            workspace_id,
            name,
            color,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if name.trim().is_empty() {
                return Err(CoordyError::invalid("label name required"));
            }
            if world
                .labels
                .iter()
                .any(|l| l.workspace_id == workspace_id && l.name == name)
            {
                return Err(CoordyError::invalid("label exists"));
            }
            world.labels.push(WorkspaceLabel {
                workspace_id: workspace_id.clone(),
                name,
                color,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("label created", json!({})))
        }
        Command::DeleteLabel { workspace_id, name } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            world
                .labels
                .retain(|l| !(l.workspace_id == workspace_id && l.name == name));
            for task in world.tasks.iter_mut().filter(|t| t.workspace_id == workspace_id) {
                task.labels.retain(|l| l != &name);
            }
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("label deleted", json!({})))
        }
        Command::SetCustomPropertyDef {
            workspace_id,
            key,
            value_type,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if key.trim().is_empty() {
                return Err(CoordyError::invalid("key required"));
            }
            if let Some(row) = world
                .custom_property_defs
                .iter_mut()
                .find(|d| d.workspace_id == workspace_id && d.key == key)
            {
                row.value_type = value_type;
            } else {
                world.custom_property_defs.push(CustomPropertyDef {
                    workspace_id: workspace_id.clone(),
                    key,
                    value_type,
                });
            }
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("property saved", json!({})))
        }
        Command::LinkPullRequest { task_id, number, url } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if let Some(row) = world.task_mut(&task_id) {
                row.pull_requests.retain(|p| p.number != number);
                row.pull_requests.push(coordy_protocol::PullRequestView { number, url });
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("pr linked", json!({ "task_id": task_id, "number": number })))
        }
        Command::SetIntegration {
            workspace_id,
            kind,
            enabled,
            config,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if let Some(row) = world
                .integrations
                .iter_mut()
                .find(|i| i.workspace_id == workspace_id && i.kind == kind)
            {
                row.enabled = enabled;
                if !config.is_empty() {
                    row.config = config;
                }
            } else {
                world.integrations.push(Integration {
                    workspace_id: workspace_id.clone(),
                    kind,
                    enabled,
                    config,
                });
            }
            emit_changed(world, workspace_id);
            Ok(Outcome::ok("integration saved", json!({})))
        }
        other => Err(CoordyError::invalid(format!(
            "unhandled product command: {}",
            command_name(&other)
        ))),
    }
}

fn command_name(command: &Command) -> &'static str {
    match command {
        Command::CreateWorkspace { .. } => "CreateWorkspace",
        _ => "other",
    }
}

pub fn project_view(project: &Project, world: &World) -> ProjectView {
    let related = world
        .tasks
        .iter()
        .filter(|t| t.project_id.as_deref() == Some(project.id.as_str()) && !t.deleted)
        .collect::<Vec<_>>();
    let done = related.iter().filter(|t| t.status == "done").count();
    let progress = if related.is_empty() {
        0
    } else {
        ((done * 100) / related.len()) as u32
    };
    ProjectView {
        id: project.id.clone(),
        workspace_id: project.workspace_id.clone(),
        name: project.name.clone(),
        icon: project.icon.clone(),
        description: project.description.clone(),
        status: project.status.clone(),
        priority: project.priority.clone(),
        lead_id: project.lead_id.clone(),
        start_date: project.start_date.clone(),
        due_date: project.due_date.clone(),
        resource: project.resource.clone(),
        progress,
    }
}

pub fn squad_view(squad: &Squad) -> SquadView {
    SquadView {
        id: squad.id.clone(),
        workspace_id: squad.workspace_id.clone(),
        name: squad.name.clone(),
        leader_agent_id: squad.leader_agent_id.clone(),
        member_agent_ids: squad.member_agent_ids.clone(),
    }
}

pub fn skill_view(skill: &Skill) -> SkillView {
    SkillView {
        id: skill.id.clone(),
        workspace_id: skill.workspace_id.clone(),
        name: skill.name.clone(),
        body: skill.body.clone(),
    }
}

pub fn automation_view(auto: &Automation) -> AutomationView {
    AutomationView {
        id: auto.id.clone(),
        workspace_id: auto.workspace_id.clone(),
        name: auto.name.clone(),
        runbook: auto.runbook.clone(),
        assignee_agent_id: auto.assignee_agent_id.clone(),
        schedule: auto.schedule.clone(),
        create_issue: auto.create_issue,
        last_run_id: auto.last_run_id.clone(),
        run_count: auto.run_count,
    }
}

pub fn comment_view(comment: &Comment, world: &World) -> CommentView {
    CommentView {
        id: comment.id.clone(),
        task_id: comment.task_id.clone(),
        author_id: comment.author_id.clone(),
        body: comment.body.clone(),
        parent_id: comment.parent_id.clone(),
        resolved: comment.resolved,
        conclusion: comment.conclusion,
        reactions: world
            .reactions
            .iter()
            .filter(|r| r.target_id == comment.id)
            .map(|r| r.emoji.clone())
            .collect(),
        mentions: comment.mentions.clone(),
    }
}

pub fn chat_view(chat: &Chat) -> ChatView {
    ChatView {
        id: chat.id.clone(),
        workspace_id: chat.workspace_id.clone(),
        agent_id: chat.agent_id.clone(),
        owner_principal_id: chat.owner_principal_id.clone(),
        project_id: chat.project_id.clone(),
        archived: chat.archived,
        title: chat.title.clone(),
        task_id: chat.task_id.clone(),
    }
}

pub fn chat_message_view(message: &ChatMessage) -> ChatMessageView {
    ChatMessageView {
        id: message.id.clone(),
        chat_id: message.chat_id.clone(),
        role: message.role.clone(),
        body: message.body.clone(),
        run_id: message.run_id.clone(),
    }
}

pub fn stats_view(world: &World, workspace_id: &str) -> StatsView {
    let issues = world
        .tasks
        .iter()
        .filter(|t| t.workspace_id == workspace_id && !t.deleted)
        .collect::<Vec<_>>();
    StatsView {
        issue_count: issues.len(),
        open_count: issues.iter().filter(|t| t.status != "done" && t.status != "cancelled").count(),
        done_count: issues.iter().filter(|t| t.status == "done").count(),
        agent_count: world
            .agents
            .iter()
            .filter(|a| a.workspace_id == workspace_id && !a.archived)
            .count(),
        run_count: world.runs.iter().filter(|r| r.workspace_id == workspace_id).count(),
        project_count: world.projects.iter().filter(|p| p.workspace_id == workspace_id).count(),
    }
}

pub fn account_view(world: &World, actor: &Actor) -> Result<AccountView, CoordyError> {
    let Some(pid) = actor.principal_id() else {
        return Err(CoordyError::denied("account is for a member"));
    };
    let principal = world
        .principal(pid)
        .ok_or_else(|| CoordyError::not_found("principal"))?;
    Ok(AccountView {
        principal_id: principal.id.clone(),
        name: principal.name.clone(),
        notify_desktop: true,
    })
}

pub fn can_see_chat(actor: &Actor, chat: &Chat) -> bool {
    match actor {
        Actor::Daemon => true,
        Actor::Principal { id } => chat.owner_principal_id == *id,
        Actor::Agent { id, principal_id } => chat.agent_id == *id || chat.owner_principal_id == *principal_id,
    }
}

pub fn mentions_from_body(body: &str) -> Vec<Mention> {
    let mut out = Vec::new();
    for token in body.split_whitespace() {
        if let Some(rest) = token.strip_prefix('@') {
            if rest == "all" {
                out.push(Mention {
                    kind: "all".into(),
                    id: "all".into(),
                });
            } else if let Some(id) = rest.strip_prefix("agent:") {
                out.push(Mention {
                    kind: "agent".into(),
                    id: id.to_string(),
                });
            } else if let Some(id) = rest.strip_prefix("squad:") {
                out.push(Mention {
                    kind: "squad".into(),
                    id: id.to_string(),
                });
            } else {
                out.push(Mention {
                    kind: "principal".into(),
                    id: rest.to_string(),
                });
            }
        }
    }
    out
}

pub fn default_new_workspace(name: &str) -> (String, String) {
    (slugify(name), "COOR".into())
}

#[allow(dead_code)]
pub fn label_view(label: &WorkspaceLabel) -> LabelView {
    LabelView {
        name: label.name.clone(),
        color: label.color.clone(),
    }
}

#[allow(dead_code)]
pub fn computer_view(computer: &Computer) -> ComputerView {
    ComputerView {
        id: computer.id.clone(),
        workspace_id: computer.workspace_id.clone(),
        name: computer.name.clone(),
        kind: computer.kind.clone(),
        online: computer.online,
        concurrency_limit: computer.concurrency_limit,
    }
}
