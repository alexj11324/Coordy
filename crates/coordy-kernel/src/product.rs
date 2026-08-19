use std::collections::{HashMap, HashSet};

use coordy_protocol::{
    AccountView, Actor, AttachmentView, AutomationView, ChatMessageView, ChatView, Command,
    CommentView, ComputerView, CoordyError, DependencyView, Effect, GithubPullRequestItem,
    GithubView, GraphEdgeKind, GraphEdgeState, GraphEdgeView, GraphHealthView, GraphNodeView,
    GraphTimelineEventView, InboxView, LabelView, Mention, NodeKind, NodeMaterializationView,
    NodeRef, Outcome, ProjectView, PullRequestView, ReviewPacket, RunRole, SkillView, SquadView,
    StatsView, TaskPlanApplyMode, TaskPlanAssignee, TaskPlanDraft, TaskPlanParent,
    TaskPlanProgressView, TaskPlanProposalView, TaskView, ValidationChoice, WorkspaceView,
    ISSUE_BLOCKER_REASON, STALE_DEPENDENCY_REASON, TASK_PLAN_VERSION,
};
use serde_json::json;

use crate::authority::{actor_in_workspace, can_command_agent};
use crate::ids;
use crate::world::{
    Attachment, Automation, Chat, ChatMessage, Comment, Computer, CustomPropertyDef, DirectoryLock,
    GraphEdge, Integration, IssueBlockerEdge, NodeMaterialization, Principal, Project, Reaction,
    Run, Skill, Squad, Task, TaskPlanApplication, TaskPlanProposalRecord, TaskSubscription,
    Workspace, WorkspaceLabel, World,
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

pub fn ensure_unique_slug(
    world: &World,
    workspace_id: &str,
    slug: &str,
) -> Result<(), CoordyError> {
    if world
        .workspaces
        .iter()
        .any(|w| w.id != workspace_id && !w.archived && w.slug == slug)
    {
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
        conductor_agent_id: ws.conductor_agent_id.clone(),
    }
}

pub fn allocate_issue_number(
    world: &mut World,
    workspace_id: &str,
) -> Result<(u64, String), CoordyError> {
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
        blocker_ids: issue_blocker_ids(world, &task.id),
        blocking_ids: issue_blocking_ids(world, &task.id),
        unresolved_blocker_ids: unresolved_blocker_ids(world, &task.id),
        task_plan_progress: task_plan_progress(world, &task.id),
    }
}

pub(crate) fn is_managed_task_plan_parent(world: &World, task_id: &str) -> bool {
    world
        .task_plan_applications
        .iter()
        .any(|application| application.parent_task_id == task_id)
}

pub(crate) fn direct_task_plan_children<'a>(
    world: &'a World,
    parent_task_id: &str,
) -> Vec<&'a Task> {
    world
        .tasks
        .iter()
        .filter(|task| !task.deleted && task.parent_id.as_deref() == Some(parent_task_id))
        .collect()
}

pub(crate) fn managed_parent_children_all_done(world: &World, parent_task_id: &str) -> bool {
    if !is_managed_task_plan_parent(world, parent_task_id) {
        return false;
    }
    let children = direct_task_plan_children(world, parent_task_id);
    !children.is_empty() && children.iter().all(|child| child.status == "done")
}

pub(crate) fn task_plan_progress(
    world: &World,
    parent_task_id: &str,
) -> Option<TaskPlanProgressView> {
    if !is_managed_task_plan_parent(world, parent_task_id) {
        return None;
    }
    let children = direct_task_plan_children(world, parent_task_id);
    let total = children.len() as u32;
    let done = children
        .iter()
        .filter(|child| child.status == "done")
        .count() as u32;
    let running = children
        .iter()
        .filter(|child| {
            !matches!(child.status.as_str(), "done" | "cancelled")
                && (child.status == "running"
                    || world
                        .runs
                        .iter()
                        .any(|run| run.task_id == child.id && run.status == "running"))
        })
        .count() as u32;
    let blocked = children
        .iter()
        .filter(|child| {
            child.status == "blocked"
                || child.blocked_reason.is_some()
                || !unresolved_blocker_ids(world, &child.id).is_empty()
        })
        .count() as u32;
    let current_stage = children
        .iter()
        .filter(|child| child.status != "done")
        .filter_map(|child| child.stage.parse::<u32>().ok())
        .min();
    Some(TaskPlanProgressView {
        total,
        done,
        running,
        blocked,
        remaining: total.saturating_sub(done),
        current_stage,
    })
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

pub fn task_plan_view(proposal: &TaskPlanProposalRecord) -> TaskPlanProposalView {
    TaskPlanProposalView {
        id: proposal.id.clone(),
        revision: proposal.revision,
        created_by: proposal.created_by.clone(),
        created_at: proposal.created_at.clone(),
        draft: proposal.draft.clone(),
    }
}

pub(crate) fn validate_task_plan(
    world: &World,
    actor: &Actor,
    draft: &TaskPlanDraft,
) -> Result<(), CoordyError> {
    require_not_agent(actor)?;
    require_member(world, actor, &draft.workspace_id)?;
    if draft.version != TASK_PLAN_VERSION {
        return Err(CoordyError::invalid("unsupported task plan version"));
    }
    let workspace = world
        .workspace(&draft.workspace_id)
        .ok_or_else(|| CoordyError::not_found("workspace"))?;
    if workspace.archived {
        return Err(CoordyError::invalid("workspace is archived"));
    }
    let chat = world
        .chat(&draft.chat_id)
        .ok_or_else(|| CoordyError::not_found("chat"))?;
    if chat.workspace_id != draft.workspace_id || chat.archived {
        return Err(CoordyError::invalid("chat is not active in this workspace"));
    }
    if let Some(principal_id) = actor.principal_id() {
        if chat.owner_principal_id != principal_id {
            return Err(CoordyError::denied("private chat owner required"));
        }
    }
    if chat.agent_id != draft.source_agent_id {
        return Err(CoordyError::invalid("source agent does not match chat"));
    }
    let run = world
        .run(&draft.source_run_id)
        .ok_or_else(|| CoordyError::not_found("source run"))?;
    if run.workspace_id != draft.workspace_id
        || run.chat_id.as_deref() != Some(draft.chat_id.as_str())
        || run.agent_id != draft.source_agent_id
    {
        return Err(CoordyError::invalid("source run provenance mismatch"));
    }

    match &draft.parent {
        TaskPlanParent::Create {
            title, project_id, ..
        } => {
            if title.trim().is_empty() {
                return Err(CoordyError::invalid("parent title is required"));
            }
            if let Some(project_id) = project_id {
                let project = world
                    .project(project_id)
                    .ok_or_else(|| CoordyError::not_found("project"))?;
                if project.workspace_id != draft.workspace_id {
                    return Err(CoordyError::invalid("project workspace mismatch"));
                }
            }
        }
        TaskPlanParent::Existing { task_id } => {
            let task = world
                .task(task_id)
                .ok_or_else(|| CoordyError::not_found("parent task"))?;
            if task.workspace_id != draft.workspace_id
                || task.deleted
                || task.stage == "chat"
                || matches!(task.status.as_str(), "done" | "cancelled")
            {
                return Err(CoordyError::invalid(
                    "parent task is not active in this workspace",
                ));
            }
        }
    }

    if draft.children.is_empty() {
        return Err(CoordyError::invalid("task plan must contain a child"));
    }
    let effective_actor = Actor::Principal {
        id: chat.owner_principal_id.clone(),
    };
    let mut keys = HashSet::new();
    for child in &draft.children {
        let key = child.key.trim();
        if key != child.key
            || key.is_empty()
            || key.len() > 64
            || !key
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        {
            return Err(CoordyError::invalid("invalid child draft key"));
        }
        if !keys.insert(key.to_string()) {
            return Err(CoordyError::invalid("duplicate child draft key"));
        }
        if child.title.trim().is_empty() {
            return Err(CoordyError::invalid("child title is required"));
        }
        if child.description.trim().is_empty() {
            return Err(CoordyError::invalid("child description is required"));
        }
        if child.acceptance_criteria.is_empty()
            || child
                .acceptance_criteria
                .iter()
                .any(|criterion| criterion.trim().is_empty())
        {
            return Err(CoordyError::invalid(
                "child acceptance criteria are required",
            ));
        }
        if !priority_ok(&child.priority) {
            return Err(CoordyError::invalid("unknown child priority"));
        }
        if child.stage == 0 {
            return Err(CoordyError::invalid("child stage must be at least 1"));
        }
        if let Some(assignee) = &child.assignee {
            match assignee {
                TaskPlanAssignee::Agent { id } => {
                    let agent = world
                        .agent(id)
                        .ok_or_else(|| CoordyError::not_found("suggested agent"))?;
                    if agent.workspace_id != draft.workspace_id || agent.archived {
                        return Err(CoordyError::invalid(
                            "suggested agent is unavailable in this workspace",
                        ));
                    }
                    if !can_command_agent(world, &effective_actor, id) {
                        return Err(CoordyError::denied(
                            "chat owner cannot command suggested agent",
                        ));
                    }
                }
                TaskPlanAssignee::Squad { id } => {
                    let squad = world
                        .squad(id)
                        .ok_or_else(|| CoordyError::not_found("suggested squad"))?;
                    if squad.workspace_id != draft.workspace_id {
                        return Err(CoordyError::invalid("suggested squad workspace mismatch"));
                    }
                    let leader = world
                        .agent(&squad.leader_agent_id)
                        .ok_or_else(|| CoordyError::not_found("suggested squad leader"))?;
                    if leader.workspace_id != draft.workspace_id || leader.archived {
                        return Err(CoordyError::invalid(
                            "suggested squad leader is unavailable in this workspace",
                        ));
                    }
                    if !can_command_agent(world, &effective_actor, &squad.leader_agent_id) {
                        return Err(CoordyError::denied(
                            "chat owner cannot command suggested squad leader",
                        ));
                    }
                }
            }
        }
    }
    for child in &draft.children {
        let mut dependencies_seen = HashSet::new();
        for dependency in &child.depends_on {
            if !dependencies_seen.insert(dependency) {
                return Err(CoordyError::invalid("duplicate dependency draft key"));
            }
            if !keys.contains(dependency.as_str()) {
                return Err(CoordyError::invalid("unknown dependency draft key"));
            }
            if dependency == &child.key {
                return Err(CoordyError::invalid("child cannot depend on itself"));
            }
            let blocker = draft
                .children
                .iter()
                .find(|candidate| candidate.key == *dependency)
                .expect("dependency key was validated");
            if blocker.stage > child.stage {
                return Err(CoordyError::invalid("child cannot depend on a later stage"));
            }
        }
    }
    if task_plan_has_cycle(draft) {
        return Err(CoordyError::invalid("task plan dependencies form a cycle"));
    }
    Ok(())
}

fn task_plan_has_cycle(draft: &TaskPlanDraft) -> bool {
    fn visit(
        key: &str,
        dependencies: &HashMap<&str, Vec<&str>>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
    ) -> bool {
        if visited.contains(key) {
            return false;
        }
        if !visiting.insert(key.to_string()) {
            return true;
        }
        if dependencies.get(key).is_some_and(|items| {
            items
                .iter()
                .any(|item| visit(item, dependencies, visiting, visited))
        }) {
            return true;
        }
        visiting.remove(key);
        visited.insert(key.to_string());
        false
    }

    let dependencies: HashMap<&str, Vec<&str>> = draft
        .children
        .iter()
        .map(|child| {
            (
                child.key.as_str(),
                child.depends_on.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    draft
        .children
        .iter()
        .any(|child| visit(&child.key, &dependencies, &mut visiting, &mut visited))
}

fn task_plan_description(description: &str, criteria: &[String]) -> String {
    let mut result = description.trim().to_string();
    result.push_str("\n\n## Acceptance criteria");
    for criterion in criteria {
        result.push_str("\n- ");
        result.push_str(criterion.trim());
    }
    result
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

pub fn github_flag(world: &World, workspace_id: &str, kind: &str) -> bool {
    world
        .integrations
        .iter()
        .find(|row| row.workspace_id == workspace_id && row.kind == kind)
        .map(|row| row.enabled)
        .unwrap_or(true)
}

pub fn github_view(world: &World, workspace_id: &str) -> GithubView {
    let state = world
        .github
        .iter()
        .find(|row| row.workspace_id == workspace_id);
    GithubView {
        enabled: github_flag(world, workspace_id, "github"),
        pr_sidebar: github_flag(world, workspace_id, "github_pr_sidebar"),
        auto_link: github_flag(world, workspace_id, "github_auto_link"),
        cli_available: state.map(|row| row.cli_available).unwrap_or(false),
        authenticated: state.map(|row| row.authenticated).unwrap_or(false),
        account: state.map(|row| row.account.clone()).unwrap_or_default(),
        last_error: state.map(|row| row.last_error.clone()).unwrap_or_default(),
        last_synced_at: state
            .map(|row| row.last_synced_at.clone())
            .unwrap_or_default(),
    }
}

fn upsert_github_state(
    world: &mut World,
    workspace_id: &str,
    cli_available: bool,
    authenticated: bool,
    account: String,
    error: String,
    fetched_at: String,
) {
    if let Some(row) = world
        .github
        .iter_mut()
        .find(|row| row.workspace_id == workspace_id)
    {
        row.cli_available = cli_available;
        row.authenticated = authenticated;
        row.account = account;
        row.last_error = error;
        row.last_synced_at = fetched_at;
        return;
    }
    world.github.push(crate::world::GithubState {
        workspace_id: workspace_id.into(),
        cli_available,
        authenticated,
        account,
        last_error: error,
        last_synced_at: fetched_at,
    });
}

fn apply_pr_snapshot(
    existing: Option<&PullRequestView>,
    item: &GithubPullRequestItem,
    linked_by: &str,
    close_intent: bool,
    fetched_at: &str,
    stale: bool,
) -> PullRequestView {
    PullRequestView {
        number: item.number,
        url: if item.url.is_empty() {
            existing.map(|row| row.url.clone()).unwrap_or_default()
        } else {
            item.url.clone()
        },
        title: item.title.clone(),
        state: item.state.clone(),
        repo: item.repo.clone(),
        branch: item.branch.clone(),
        author: item.author.clone(),
        additions: item.additions,
        deletions: item.deletions,
        changed_files: item.changed_files,
        mergeable: item.mergeable.clone(),
        merge_state: item.merge_state.clone(),
        checks_rollup: item.checks_rollup.clone(),
        checks_total: item.checks_total,
        checks_passed: item.checks_passed,
        checks_failed: item.checks_failed,
        checks_running: item.checks_running,
        failed_check_names: item.failed_check_names.clone(),
        snapshot_available: item.snapshot_available,
        snapshot_stale: stale,
        snapshot_fetched_at: fetched_at.into(),
        linked_by: linked_by.into(),
        close_intent,
    }
}

fn sync_github_pull_requests(
    world: &mut World,
    workspace_id: &str,
    items: &[GithubPullRequestItem],
    fetched_at: &str,
    stale: bool,
) -> (u32, Vec<String>, Vec<String>) {
    let enabled = github_flag(world, workspace_id, "github");
    let auto_link = enabled && github_flag(world, workspace_id, "github_auto_link");
    let prefix = world
        .workspace(workspace_id)
        .map(|ws| {
            if ws.issue_prefix.is_empty() {
                "COOR".into()
            } else {
                ws.issue_prefix.clone()
            }
        })
        .unwrap_or_else(|| "COOR".into());
    let mut linked = 0u32;
    if enabled && !stale {
        let by_number: std::collections::BTreeMap<u32, &GithubPullRequestItem> =
            items.iter().map(|item| (item.number, item)).collect();
        for task in world
            .tasks
            .iter_mut()
            .filter(|task| task.workspace_id == workspace_id && !task.deleted)
        {
            let identifier = task.identifier.clone();
            for pr in task.pull_requests.iter_mut() {
                if let Some(item) = by_number.get(&pr.number) {
                    let linked_by = if pr.linked_by.is_empty() {
                        "manual".to_string()
                    } else {
                        pr.linked_by.clone()
                    };
                    let close_intent =
                        crate::github::issue_links(&prefix, &item.branch, &item.title, &item.body)
                            .iter()
                            .any(|link| link.identifier == identifier && link.close_intent);
                    let current = pr.clone();
                    *pr = apply_pr_snapshot(
                        Some(&current),
                        item,
                        &linked_by,
                        close_intent,
                        fetched_at,
                        false,
                    );
                    linked += 1;
                }
            }
        }
        if auto_link {
            let mut additions: Vec<(String, PullRequestView)> = Vec::new();
            for item in items {
                let matches =
                    crate::github::issue_links(&prefix, &item.branch, &item.title, &item.body);
                for link in matches {
                    if let Some(task) = world.tasks.iter().find(|task| {
                        task.workspace_id == workspace_id
                            && !task.deleted
                            && task.identifier.eq_ignore_ascii_case(&link.identifier)
                    }) {
                        if task.pull_requests.iter().any(|pr| pr.number == item.number) {
                            continue;
                        }
                        additions.push((
                            task.id.clone(),
                            apply_pr_snapshot(
                                None,
                                item,
                                "auto",
                                link.close_intent,
                                fetched_at,
                                false,
                            ),
                        ));
                    }
                }
            }
            for (task_id, pr) in additions {
                if let Some(task) = world.task_mut(&task_id) {
                    task.pull_requests.retain(|row| row.number != pr.number);
                    task.pull_requests.push(pr);
                    linked += 1;
                }
            }
            for task in world
                .tasks
                .iter_mut()
                .filter(|task| task.workspace_id == workspace_id && !task.deleted)
            {
                task.pull_requests.retain(|pr| {
                    pr.linked_by != "auto" || items.iter().any(|item| item.number == pr.number)
                });
            }
        }
    } else if stale {
        for task in world
            .tasks
            .iter_mut()
            .filter(|task| task.workspace_id == workspace_id && !task.deleted)
        {
            for pr in &mut task.pull_requests {
                if pr.snapshot_available {
                    pr.snapshot_stale = true;
                }
            }
        }
    }
    let (completed, released) = complete_issues_from_merged_prs(world, workspace_id);
    (linked, completed, released)
}

fn complete_issues_from_merged_prs(
    world: &mut World,
    workspace_id: &str,
) -> (Vec<String>, Vec<String>) {
    let candidates: Vec<(String, String)> = world
        .tasks
        .iter()
        .filter(|task| {
            task.workspace_id == workspace_id
                && !task.deleted
                && !matches!(task.status.as_str(), "done" | "cancelled")
                && task
                    .pull_requests
                    .iter()
                    .any(|pr| crate::github::is_merged_state(&pr.state) && pr.close_intent)
                && !task
                    .pull_requests
                    .iter()
                    .any(|pr| crate::github::is_working_state(&pr.state))
                // Managed parents complete only through the rollup so the
                // runtime records that it may reopen them if a child regresses.
                && !is_managed_task_plan_parent(world, &task.id)
        })
        .map(|task| (task.id.clone(), task.title.clone()))
        .collect();
    let mut completed = Vec::new();
    let mut released_all = Vec::new();
    for (task_id, title) in candidates {
        if reject_if_unresolved_blockers(world, &task_id).is_err() {
            continue;
        }
        if let Some(task) = world.task_mut(&task_id) {
            task.status = "done".into();
            task.blocked_reason = None;
        }
        released_all.extend(refresh_issue_blocker_dependents(world, &task_id));
        push_notice(
            world,
            workspace_id,
            "status",
            "PR 已合并，事项完成",
            &title,
            Some(task_id.clone()),
        );
        completed.push(task_id);
    }
    (completed, released_all)
}

pub(crate) fn latest_task_plan<'a>(
    world: &'a World,
    proposal_id: &str,
) -> Option<&'a TaskPlanProposalRecord> {
    world
        .task_plan_proposals
        .iter()
        .filter(|proposal| proposal.id == proposal_id)
        .max_by_key(|proposal| proposal.revision)
}

fn latest_task_plan_record_for_chat<'a>(
    world: &'a World,
    chat_id: &str,
) -> Option<&'a TaskPlanProposalRecord> {
    world
        .task_plan_proposals
        .iter()
        .rev()
        .find(|proposal| proposal.draft.chat_id == chat_id)
}

fn save_task_plan(
    world: &mut World,
    actor: &Actor,
    proposal_id: Option<String>,
    expected_revision: Option<u64>,
    draft: TaskPlanDraft,
) -> Result<Outcome, CoordyError> {
    validate_task_plan(world, actor, &draft)?;
    let (proposal_id, revision) = match proposal_id {
        Some(proposal_id) => {
            if proposal_id.trim().is_empty() {
                return Err(CoordyError::invalid("proposal id is required"));
            }
            let current = latest_task_plan(world, &proposal_id)
                .ok_or_else(|| CoordyError::not_found("task plan proposal"))?;
            if world
                .task_plan_applications
                .iter()
                .any(|application| application.proposal_id == proposal_id)
            {
                return Err(CoordyError::invalid("applied task plan cannot be revised"));
            }
            let expected_revision = expected_revision
                .ok_or_else(|| CoordyError::invalid("expected revision is required"))?;
            if current.revision != expected_revision {
                return Err(CoordyError::invalid("stale task plan revision"));
            }
            if latest_task_plan_record_for_chat(world, &current.draft.chat_id)
                .is_some_and(|latest| latest.id != proposal_id)
            {
                return Err(CoordyError::invalid("task plan proposal was superseded"));
            }
            if current.draft.workspace_id != draft.workspace_id
                || current.draft.chat_id != draft.chat_id
                || current.draft.source_run_id != draft.source_run_id
                || current.draft.source_agent_id != draft.source_agent_id
            {
                return Err(CoordyError::invalid("task plan provenance cannot change"));
            }
            (proposal_id, current.revision + 1)
        }
        None => {
            if expected_revision.is_some() {
                return Err(CoordyError::invalid(
                    "new task plan cannot have an expected revision",
                ));
            }
            (ids::new("plan"), 1)
        }
    };
    world.task_plan_proposals.push(TaskPlanProposalRecord {
        id: proposal_id.clone(),
        revision,
        created_by: actor.id().to_string(),
        created_at: ids::now(),
        draft: draft.clone(),
    });
    emit_changed(world, draft.workspace_id);
    Ok(Outcome::ok(
        "task plan saved",
        json!({ "proposal_id": proposal_id, "revision": revision }),
    ))
}

pub(crate) fn latest_applicable_task_plan_for_chat<'a>(
    world: &'a World,
    chat_id: &str,
) -> Option<&'a TaskPlanProposalRecord> {
    latest_task_plan_record_for_chat(world, chat_id).filter(|proposal| {
        !world
            .task_plan_applications
            .iter()
            .any(|application| application.proposal_id == proposal.id)
            && latest_task_plan(world, &proposal.id)
                .is_some_and(|latest| latest.revision == proposal.revision)
    })
}

pub(crate) fn save_task_plan_from_chat_run(
    world: &mut World,
    run: &Run,
    draft: TaskPlanDraft,
) -> Result<(), CoordyError> {
    if draft.workspace_id != run.workspace_id
        || draft.chat_id != run.chat_id.clone().unwrap_or_default()
        || draft.source_run_id != run.id
        || draft.source_agent_id != run.agent_id
    {
        return Err(CoordyError::invalid(
            "task plan artifact provenance mismatch",
        ));
    }
    let chat = world
        .chat(&draft.chat_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("chat"))?;
    validate_task_plan(
        world,
        &Actor::Principal {
            id: chat.owner_principal_id,
        },
        &draft,
    )?;
    if latest_applicable_task_plan_for_chat(world, &draft.chat_id)
        .is_some_and(|proposal| proposal.draft == draft)
    {
        return Ok(());
    }
    let (id, revision) = latest_applicable_task_plan_for_chat(world, &draft.chat_id)
        .filter(|proposal| proposal.draft.source_run_id == draft.source_run_id)
        .map(|proposal| (proposal.id.clone(), proposal.revision + 1))
        .unwrap_or_else(|| (ids::new("plan"), 1));
    world.task_plan_proposals.push(TaskPlanProposalRecord {
        id,
        revision,
        created_by: run.agent_id.clone(),
        created_at: ids::now(),
        draft,
    });
    Ok(())
}

struct PlannedTaskInput<'a> {
    workspace_id: &'a str,
    title: String,
    description: String,
    priority: String,
    project_id: Option<String>,
    parent_id: Option<String>,
    stage: String,
}

fn create_planned_task(
    world: &mut World,
    input: PlannedTaskInput<'_>,
) -> Result<String, CoordyError> {
    let (number, identifier) = allocate_issue_number(world, input.workspace_id)?;
    let id = ids::new("task");
    let sort_key = world.tasks.len() as i64;
    world.tasks.push(Task {
        id: id.clone(),
        workspace_id: input.workspace_id.to_string(),
        title: input.title,
        description: input.description,
        status: "backlog".into(),
        assignee_agent_id: None,
        worktree_path: None,
        blocked_reason: None,
        identifier,
        number,
        priority: input.priority,
        start_date: None,
        due_date: None,
        labels: Vec::new(),
        custom_fields: Vec::new(),
        assignee_principal_id: None,
        assignee_squad_id: None,
        project_id: input.project_id,
        parent_id: input.parent_id,
        stage: input.stage,
        sort_key,
        deleted: false,
        pull_requests: Vec::new(),
    });
    Ok(id)
}

fn apply_task_plan(
    world: &mut World,
    actor: &Actor,
    proposal_id: &str,
    expected_revision: u64,
    idempotency_key: &str,
    mode: TaskPlanApplyMode,
) -> Result<Outcome, CoordyError> {
    require_not_agent(actor)?;
    if idempotency_key.trim().is_empty() || idempotency_key.len() > 128 {
        return Err(CoordyError::invalid("invalid idempotency key"));
    }
    let proposal = latest_task_plan(world, proposal_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("task plan proposal"))?;
    require_member(world, actor, &proposal.draft.workspace_id)?;
    let chat = world
        .chat(&proposal.draft.chat_id)
        .ok_or_else(|| CoordyError::not_found("chat"))?;
    if actor
        .principal_id()
        .is_some_and(|principal_id| principal_id != chat.owner_principal_id)
    {
        return Err(CoordyError::denied("private chat owner required"));
    }
    if let Some(application) = world.task_plan_applications.iter().find(|application| {
        application.proposal_id == proposal_id && application.idempotency_key == idempotency_key
    }) {
        if application.applied_by != actor.id() {
            return Err(CoordyError::denied(
                "idempotency key belongs to another actor",
            ));
        }
        return Ok(Outcome::ok(
            "task plan already applied",
            json!({
                "proposal_id": application.proposal_id,
                "revision": application.proposal_revision,
                "parent_task_id": application.parent_task_id,
                "child_task_ids": application.child_task_ids,
            }),
        ));
    }
    if world
        .task_plan_applications
        .iter()
        .any(|application| application.proposal_id == proposal_id)
    {
        return Err(CoordyError::invalid(
            "task plan proposal is already applied",
        ));
    }
    if latest_task_plan_record_for_chat(world, &proposal.draft.chat_id)
        .is_some_and(|latest| latest.id != proposal_id)
    {
        return Err(CoordyError::invalid("task plan proposal was superseded"));
    }
    if proposal.revision != expected_revision {
        return Err(CoordyError::invalid("stale task plan revision"));
    }
    validate_task_plan(world, actor, &proposal.draft)?;

    // No IDs, issue numbers, notices, or task state are allocated until the
    // complete preflight above succeeds. The staged world is swapped in only
    // after every mutation below has completed successfully.
    let mut staged = world.clone();
    let (parent_task_id, project_id) = match &proposal.draft.parent {
        TaskPlanParent::Create {
            title,
            description,
            project_id,
        } => {
            let parent_id = create_planned_task(
                &mut staged,
                PlannedTaskInput {
                    workspace_id: &proposal.draft.workspace_id,
                    title: title.trim().to_string(),
                    description: description.trim().to_string(),
                    priority: "none".into(),
                    project_id: project_id.clone(),
                    parent_id: None,
                    stage: String::new(),
                },
            )?;
            if let Some(parent) = staged.task_mut(&parent_id) {
                parent.status = "open".into();
            }
            (parent_id, project_id.clone())
        }
        TaskPlanParent::Existing { task_id } => {
            let parent = staged
                .task(task_id)
                .ok_or_else(|| CoordyError::not_found("parent task"))?;
            (task_id.clone(), parent.project_id.clone())
        }
    };

    let mut key_to_id = HashMap::new();
    let mut child_task_ids = Vec::with_capacity(proposal.draft.children.len());
    for child in &proposal.draft.children {
        let task_id = create_planned_task(
            &mut staged,
            PlannedTaskInput {
                workspace_id: &proposal.draft.workspace_id,
                title: child.title.trim().to_string(),
                description: task_plan_description(&child.description, &child.acceptance_criteria),
                priority: child.priority.clone(),
                project_id: project_id.clone(),
                parent_id: Some(parent_task_id.clone()),
                stage: child.stage.to_string(),
            },
        )?;
        if let Some(task) = staged.task_mut(&task_id) {
            match &child.assignee {
                Some(TaskPlanAssignee::Agent { id }) => {
                    task.assignee_agent_id = Some(id.clone());
                }
                Some(TaskPlanAssignee::Squad { id }) => {
                    task.assignee_squad_id = Some(id.clone());
                }
                None => {}
            }
        }
        key_to_id.insert(child.key.clone(), task_id.clone());
        child_task_ids.push(task_id);
    }
    for child in &proposal.draft.children {
        let task_id = key_to_id
            .get(&child.key)
            .expect("preflight guarantees every child key");
        for dependency in &child.depends_on {
            let blocker_id = key_to_id
                .get(dependency)
                .expect("preflight guarantees every dependency key");
            add_issue_blocker(&mut staged, actor, task_id, blocker_id)?;
        }
    }
    for task_id in &child_task_ids {
        if let Some(task) = staged.task_mut(task_id) {
            task.status = "backlog".into();
            task.blocked_reason = None;
        }
    }
    if mode == TaskPlanApplyMode::ConfirmAndStart {
        let first_stage = proposal
            .draft
            .children
            .iter()
            .map(|child| child.stage)
            .min()
            .expect("preflight requires a child");
        for child in &proposal.draft.children {
            if child.stage == first_stage && child.depends_on.is_empty() {
                let task_id = key_to_id
                    .get(&child.key)
                    .expect("preflight guarantees every child key");
                if let Some(task) = staged.task_mut(task_id) {
                    task.status = "open".into();
                }
            }
        }
    }
    staged.task_plan_applications.push(TaskPlanApplication {
        proposal_id: proposal_id.to_string(),
        proposal_revision: proposal.revision,
        idempotency_key: idempotency_key.to_string(),
        applied_by: actor.id().to_string(),
        applied_at: ids::now(),
        mode,
        parent_task_id: parent_task_id.clone(),
        child_task_ids: child_task_ids.clone(),
    });
    emit_changed(&mut staged, proposal.draft.workspace_id.clone());
    *world = staged;
    Ok(Outcome::ok(
        "task plan applied",
        json!({
            "proposal_id": proposal_id,
            "revision": proposal.revision,
            "parent_task_id": parent_task_id,
            "child_task_ids": child_task_ids,
            "draft_key_to_task_id": key_to_id,
        }),
    ))
}

pub fn submit(world: &mut World, actor: &Actor, command: Command) -> Result<Outcome, CoordyError> {
    match command {
        Command::SaveTaskPlanProposal {
            proposal_id,
            expected_revision,
            draft,
        } => save_task_plan(world, actor, proposal_id, expected_revision, draft),
        Command::ApplyTaskPlan {
            proposal_id,
            expected_revision,
            idempotency_key,
            mode,
        } => apply_task_plan(
            world,
            actor,
            &proposal_id,
            expected_revision,
            &idempotency_key,
            mode,
        ),
        Command::UpdateWorkspace {
            workspace_id,
            name,
            icon,
            description,
            context,
            slug,
            issue_prefix,
            conductor_agent_id,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            if let Some(conductor_id) = conductor_agent_id.as_ref().filter(|id| !id.is_empty()) {
                let agent = world
                    .agent(conductor_id)
                    .ok_or_else(|| CoordyError::not_found("agent"))?;
                if agent.workspace_id != workspace_id {
                    return Err(CoordyError::invalid(
                        "conductor must belong to this workspace",
                    ));
                }
                if agent.archived {
                    return Err(CoordyError::invalid(
                        "conductor cannot be an archived agent",
                    ));
                }
            }
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
            if let Some(conductor_id) = conductor_agent_id {
                ws.conductor_agent_id = if conductor_id.is_empty() {
                    None
                } else {
                    Some(conductor_id)
                };
            }
            emit_changed(world, workspace_id.clone());
            Ok(Outcome::ok(
                "workspace updated",
                json!({ "workspace_id": workspace_id }),
            ))
        }
        Command::DeleteWorkspace { workspace_id } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let Some(ws) = world.workspaces.iter_mut().find(|w| w.id == workspace_id) else {
                return Err(CoordyError::not_found("workspace"));
            };
            ws.archived = true;
            emit_changed(world, workspace_id.clone());
            Ok(Outcome::ok(
                "workspace deleted",
                json!({ "workspace_id": workspace_id }),
            ))
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
            Ok(Outcome::ok(
                "left workspace",
                json!({ "principal_id": pid }),
            ))
        }
        Command::InvitePrincipal {
            workspace_id,
            name,
            role,
        } => {
            require_not_agent(actor)?;
            require_member(world, actor, &workspace_id)?;
            let role = if role.is_empty() {
                "member".into()
            } else {
                role
            };
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
            Ok(Outcome::ok(
                "role updated",
                json!({ "principal_id": principal_id, "role": role }),
            ))
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
                    row.assignee_agent_id = if agent_id.is_empty() {
                        None
                    } else {
                        Some(agent_id)
                    };
                }
                if let Some(principal_id) = principal_id {
                    row.assignee_principal_id = if principal_id.is_empty() {
                        None
                    } else {
                        Some(principal_id)
                    };
                }
                if let Some(squad_id) = squad_id {
                    row.assignee_squad_id = if squad_id.is_empty() {
                        None
                    } else {
                        Some(squad_id)
                    };
                }
                if let Some(project_id) = project_id {
                    row.project_id = if project_id.is_empty() {
                        None
                    } else {
                        Some(project_id)
                    };
                }
                if let Some(parent_id) = parent_id {
                    row.parent_id = if parent_id.is_empty() {
                        None
                    } else {
                        Some(parent_id)
                    };
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
            let dependents = issue_blocking_ids(world, &task_id);
            let released: Vec<String> = dependents
                .iter()
                .filter(|dep| waiting_task_would_release(world, dep, &task_id))
                .cloned()
                .collect();
            world
                .issue_blockers
                .retain(|edge| edge.task_id != task_id && edge.blocker_id != task_id);
            for dep in dependents {
                sync_issue_blocker_hold(world, &dep);
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok(
                "task deleted",
                json!({ "task_id": task_id, "released_task_ids": released }),
            ))
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
        Command::AddAttachment {
            task_id,
            name,
            path,
        } => {
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
            let Some(att) = world
                .attachments
                .iter()
                .find(|a| a.id == attachment_id)
                .cloned()
            else {
                return Err(CoordyError::not_found("attachment"));
            };
            let workspace_id = world.task(&att.task_id).map(|t| t.workspace_id.clone());
            world.attachments.retain(|a| a.id != attachment_id);
            if let Some(workspace_id) = workspace_id {
                emit_changed(world, workspace_id);
            }
            Ok(Outcome::ok(
                "removed",
                json!({ "attachment_id": attachment_id }),
            ))
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
        Command::SetNotificationPrefs {
            workspace_id,
            kinds,
        } => {
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
                    row.lead_id = if lead_id.is_empty() {
                        None
                    } else {
                        Some(lead_id)
                    };
                }
                if let Some(start_date) = start_date {
                    row.start_date = if start_date.is_empty() {
                        None
                    } else {
                        Some(start_date)
                    };
                }
                if let Some(due_date) = due_date {
                    row.due_date = if due_date.is_empty() {
                        None
                    } else {
                        Some(due_date)
                    };
                }
                if let Some(resource) = resource {
                    row.resource = resource;
                }
            }
            emit_changed(world, project.workspace_id);
            Ok(Outcome::ok(
                "project updated",
                json!({ "project_id": project_id }),
            ))
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
            Ok(Outcome::ok(
                "project deleted",
                json!({ "project_id": project_id }),
            ))
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
            Ok(Outcome::ok(
                "squad updated",
                json!({ "squad_id": squad_id }),
            ))
        }
        Command::SetSquadMembers {
            squad_id,
            agent_ids,
        } => {
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
            Ok(Outcome::ok(
                "squad members updated",
                json!({ "squad_id": squad_id }),
            ))
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
            Ok(Outcome::ok(
                "squad deleted",
                json!({ "squad_id": squad_id }),
            ))
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
            Ok(Outcome::ok(
                "skill updated",
                json!({ "skill_id": skill_id }),
            ))
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
            Ok(Outcome::ok(
                "skill deleted",
                json!({ "skill_id": skill_id }),
            ))
        }
        Command::SetAgentSkills {
            agent_id,
            skill_ids,
        } => {
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
                last_triggered_at: None,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok(
                "automation created",
                json!({ "automation_id": id }),
            ))
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
            Ok(Outcome::ok(
                "automation updated",
                json!({ "automation_id": automation_id }),
            ))
        }
        Command::TriggerAutomation { automation_id } => {
            require_not_agent(actor)?;
            let auto = world
                .automation(&automation_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("automation"))?;
            require_member(world, actor, &auto.workspace_id)?;
            let now_ms = chrono::Utc::now().timestamp_millis();
            trigger_automation(world, &automation_id, now_ms)
        }
        Command::SweepAutomations { now_ms } => {
            if !matches!(actor, Actor::Daemon) {
                return Err(CoordyError::denied("only the daemon may sweep automations"));
            }
            sweep_automations(world, now_ms)
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
            Ok(Outcome::ok(
                "automation deleted",
                json!({ "automation_id": automation_id }),
            ))
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
                        "你被提及",
                        &body,
                        Some(task_id.clone()),
                    );
                }
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok("comment added", json!({ "comment_id": id })))
        }
        Command::ResolveComment {
            comment_id,
            resolved,
        } => {
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
            Ok(Outcome::ok(
                "comment resolved",
                json!({ "comment_id": comment_id }),
            ))
        }
        Command::SetCommentConclusion { comment_id } => {
            require_not_agent(actor)?;
            let comment = world
                .comment(&comment_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("comment"))?;
            require_member(world, actor, &comment.workspace_id)?;
            for row in world
                .comments
                .iter_mut()
                .filter(|c| c.task_id == comment.task_id)
            {
                row.conclusion = row.id == comment_id;
            }
            emit_changed(world, comment.workspace_id);
            Ok(Outcome::ok(
                "conclusion set",
                json!({ "comment_id": comment_id }),
            ))
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
                return Err(CoordyError::denied(
                    "only a member can start a private chat",
                ));
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
            Ok(Outcome::ok(
                "message sent",
                json!({ "message_id": id, "chat_id": chat_id }),
            ))
        }
        Command::StopChat { chat_id } => {
            let chat = world
                .chat(&chat_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("chat"))?;
            for run in world
                .runs
                .iter_mut()
                .filter(|r| r.chat_id.as_deref() == Some(chat_id.as_str()) && r.status == "running")
            {
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
            let kind = if kind.is_empty() {
                "local".into()
            } else {
                kind
            };
            let concurrency_limit = if concurrency_limit == 0 {
                20
            } else {
                concurrency_limit
            };
            if let Some(idx) = world
                .computers
                .iter()
                .position(|c| c.workspace_id == workspace_id && c.name == name)
            {
                let id = {
                    let computer = &mut world.computers[idx];
                    computer.kind = kind;
                    computer.concurrency_limit = concurrency_limit;
                    computer.id.clone()
                };
                emit_changed(world, workspace_id);
                return Ok(Outcome::ok(
                    "computer registered",
                    json!({ "computer_id": id }),
                ));
            }
            let id = ids::new("pc");
            world.computers.push(Computer {
                id: id.clone(),
                workspace_id: workspace_id.clone(),
                name,
                kind,
                // Registration-time flag only. Coordy does not probe host liveness.
                online: true,
                concurrency_limit,
            });
            emit_changed(world, workspace_id);
            Ok(Outcome::ok(
                "computer registered",
                json!({ "computer_id": id }),
            ))
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
                return Err(CoordyError::denied(
                    "only the owner may duplicate this agent",
                ));
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
            for task in world
                .tasks
                .iter_mut()
                .filter(|t| t.workspace_id == workspace_id)
            {
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
        Command::LinkPullRequest {
            task_id,
            number,
            url,
        } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if let Some(row) = world.task_mut(&task_id) {
                row.pull_requests.retain(|p| p.number != number);
                row.pull_requests.push(PullRequestView::manual(number, url));
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok(
                "pr linked",
                json!({ "task_id": task_id, "number": number }),
            ))
        }
        Command::UnlinkPullRequest { task_id, number } => {
            require_not_agent(actor)?;
            let task = world
                .task(&task_id)
                .cloned()
                .ok_or_else(|| CoordyError::not_found("task"))?;
            require_member(world, actor, &task.workspace_id)?;
            if let Some(row) = world.task_mut(&task_id) {
                row.pull_requests.retain(|p| p.number != number);
            }
            emit_changed(world, task.workspace_id);
            Ok(Outcome::ok(
                "pr unlinked",
                json!({ "task_id": task_id, "number": number }),
            ))
        }
        Command::SyncGithubPullRequests(sync) => {
            if !matches!(actor, Actor::Daemon) {
                return Err(CoordyError::denied(
                    "only the daemon may submit GitHub snapshots",
                ));
            }
            let fetched_at = if sync.fetched_at.is_empty() {
                ids::now()
            } else {
                sync.fetched_at.clone()
            };
            let stale = !sync.error.is_empty();
            upsert_github_state(
                world,
                &sync.workspace_id,
                sync.cli_available,
                sync.authenticated,
                sync.account.clone(),
                sync.error.clone(),
                fetched_at.clone(),
            );
            let (linked, completed, released) = sync_github_pull_requests(
                world,
                &sync.workspace_id,
                &sync.items,
                &fetched_at,
                stale,
            );
            let message = if sync.error.is_empty() {
                "github synced"
            } else {
                "github sync failed"
            };
            emit_changed(world, sync.workspace_id.clone());
            Ok(Outcome::ok(
                message,
                json!({
                    "linked": linked,
                    "completed": completed,
                    "released_task_ids": released,
                    "changed": linked > 0 || !completed.is_empty() || !sync.error.is_empty(),
                }),
            ))
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
        Command::AddIssueBlocker {
            task_id,
            blocker_id,
        } => {
            require_not_agent(actor)?;
            add_issue_blocker(world, actor, &task_id, &blocker_id)
        }
        Command::RemoveIssueBlocker {
            task_id,
            blocker_id,
        } => {
            require_not_agent(actor)?;
            remove_issue_blocker(world, actor, &task_id, &blocker_id)
        }
        Command::SetWorkspaceConductor {
            workspace_id,
            agent_id,
        } => set_workspace_conductor(world, actor, &workspace_id, agent_id),
        Command::ValidationDecision {
            dependency_id,
            expected_generation,
            decision,
            evidence_refs,
            rationale,
            validator_run_id,
        } => apply_validation_decision(
            world,
            actor,
            &dependency_id,
            expected_generation,
            decision,
            evidence_refs,
            rationale,
            validator_run_id,
        ),
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
        last_triggered_at: auto.last_triggered_at.clone(),
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
        open_count: issues
            .iter()
            .filter(|t| t.status != "done" && t.status != "cancelled")
            .count(),
        done_count: issues.iter().filter(|t| t.status == "done").count(),
        agent_count: world
            .agents
            .iter()
            .filter(|a| a.workspace_id == workspace_id && !a.archived)
            .count(),
        run_count: world
            .runs
            .iter()
            .filter(|r| r.workspace_id == workspace_id)
            .count(),
        project_count: world
            .projects
            .iter()
            .filter(|p| p.workspace_id == workspace_id)
            .count(),
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
        Actor::Agent { id, principal_id } => {
            chat.agent_id == *id || chat.owner_principal_id == *principal_id
        }
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

pub fn parse_schedule_interval_ms(schedule: &str) -> Option<i64> {
    let raw = schedule.trim().to_ascii_lowercase();
    let rest = raw.strip_prefix("every:")?.trim();
    if let Some(digits) = rest.strip_suffix('m') {
        return digits
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|n| *n > 0)
            .map(|n| n.saturating_mul(60_000));
    }
    if let Some(digits) = rest.strip_suffix('h') {
        return digits
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|n| *n > 0)
            .map(|n| n.saturating_mul(3_600_000));
    }
    if let Some(digits) = rest.strip_suffix('d') {
        return digits
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|n| *n > 0)
            .map(|n| n.saturating_mul(86_400_000));
    }
    None
}

fn rfc3339_to_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn rfc3339_from_ms(now_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms)
        .unwrap_or_else(|| chrono::Utc::now())
        .to_rfc3339()
}

fn trigger_automation(
    world: &mut World,
    automation_id: &str,
    now_ms: i64,
) -> Result<Outcome, CoordyError> {
    let auto = world
        .automation(automation_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("automation"))?;
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
    let stamped = rfc3339_from_ms(now_ms);
    if let Some(row) = world.automations.iter_mut().find(|a| a.id == automation_id) {
        row.run_count += 1;
        row.last_triggered_at = Some(stamped);
    }
    push_notice(
        world,
        &auto.workspace_id,
        "automation",
        "自动化已运行",
        &auto.name,
        created_task.clone(),
    );
    emit_changed(world, auto.workspace_id.clone());
    let dispatch = created_task.as_ref().and_then(|task_id| {
        auto.assignee_agent_id.as_ref().map(|agent_id| {
            json!({
                "automation_id": automation_id,
                "task_id": task_id,
                "agent_id": agent_id,
                "prompt": auto.runbook,
            })
        })
    });
    Ok(Outcome::ok(
        "automation triggered",
        json!({
            "automation_id": automation_id,
            "task_id": created_task,
            "dispatches": dispatch.as_ref().map(|d| vec![d.clone()]).unwrap_or_default(),
        }),
    ))
}

fn sweep_automations(world: &mut World, now_ms: i64) -> Result<Outcome, CoordyError> {
    let autos = world.automations.clone();
    let mut triggered = Vec::new();
    let mut armed = 0u32;
    let mut dispatches = Vec::new();
    for auto in autos {
        let Some(interval) = parse_schedule_interval_ms(&auto.schedule) else {
            continue;
        };
        match auto.last_triggered_at.as_deref().and_then(rfc3339_to_ms) {
            None => {
                if let Some(row) = world.automations.iter_mut().find(|a| a.id == auto.id) {
                    row.last_triggered_at = Some(rfc3339_from_ms(now_ms));
                }
                armed += 1;
            }
            Some(last_ms) if now_ms.saturating_sub(last_ms) >= interval => {
                let outcome = trigger_automation(world, &auto.id, now_ms)?;
                triggered.push(auto.id.clone());
                if let Some(items) = outcome.ids.get("dispatches").and_then(|v| v.as_array()) {
                    dispatches.extend(items.iter().cloned());
                }
            }
            Some(_) => {}
        }
    }
    Ok(Outcome::ok(
        "automations swept",
        json!({
            "armed": armed,
            "triggered": triggered,
            "dispatches": dispatches,
        }),
    ))
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

fn issue_blocker_satisfied(world: &World, blocker_id: &str) -> bool {
    match world.task(blocker_id) {
        None => true,
        Some(task) => task.deleted || task.status == "done" || task.status == "cancelled",
    }
}

pub(crate) fn issue_blocker_ids(world: &World, task_id: &str) -> Vec<String> {
    world
        .issue_blockers
        .iter()
        .filter(|edge| edge.task_id == task_id)
        .map(|edge| edge.blocker_id.clone())
        .collect()
}

pub(crate) fn issue_blocking_ids(world: &World, task_id: &str) -> Vec<String> {
    world
        .issue_blockers
        .iter()
        .filter(|edge| edge.blocker_id == task_id)
        .map(|edge| edge.task_id.clone())
        .collect()
}

pub(crate) fn unresolved_blocker_ids(world: &World, task_id: &str) -> Vec<String> {
    issue_blocker_ids(world, task_id)
        .into_iter()
        .filter(|id| !issue_blocker_satisfied(world, id))
        .collect()
}

fn happens_before_successors(world: &World, node: &str) -> Vec<String> {
    let mut next = issue_blocking_ids(world, node);
    next.extend(
        world
            .dependencies
            .iter()
            .filter(|dep| dep.state != GraphEdgeState::Superseded && dep.source.id == node)
            .map(|dep| dep.target.id.clone()),
    );
    next
}

fn issue_graph_reaches(world: &World, from: &str, target: &str) -> bool {
    let mut stack = vec![from.to_string()];
    let mut seen = std::collections::HashSet::new();
    while let Some(node) = stack.pop() {
        if !seen.insert(node.clone()) {
            continue;
        }
        if node == target {
            return true;
        }
        stack.extend(happens_before_successors(world, &node));
    }
    false
}

fn issue_label(world: &World, task_id: &str) -> String {
    world
        .task(task_id)
        .map(|task| {
            if task.identifier.is_empty() {
                task.title.clone()
            } else {
                format!("{} {}", task.identifier, task.title)
            }
        })
        .unwrap_or_else(|| task_id.to_string())
}

pub(crate) fn reject_if_unresolved_blockers(
    world: &World,
    task_id: &str,
) -> Result<(), CoordyError> {
    let unresolved = unresolved_blocker_ids(world, task_id);
    if unresolved.is_empty() {
        return Ok(());
    }
    let labels: Vec<String> = unresolved.iter().map(|id| issue_label(world, id)).collect();
    Err(CoordyError::invalid(format!(
        "前置事项尚未完成：{}",
        labels.join("、")
    )))
}

pub(crate) fn task_has_stale_dependency(world: &World, task_id: &str) -> bool {
    world.dependencies.iter().any(|dep| {
        dep.target.id == task_id
            && dep.kind == GraphEdgeKind::Consumes
            && dep.state.blocks_consumer()
    })
}

pub(crate) fn reject_if_stale_dependencies(
    world: &World,
    task_id: &str,
) -> Result<(), CoordyError> {
    if task_has_stale_dependency(world, task_id) {
        Err(CoordyError::invalid(STALE_DEPENDENCY_REASON))
    } else {
        Ok(())
    }
}

pub(crate) fn apply_stale_dependency_hold(world: &mut World, task_id: &str) {
    let Some(task) = world.task_mut(task_id) else {
        return;
    };
    if task.deleted || task.status == "done" || task.status == "cancelled" {
        return;
    }
    if task.blocked_reason.is_none()
        || task.blocked_reason.as_deref() == Some(ISSUE_BLOCKER_REASON)
        || task.blocked_reason.as_deref() == Some(STALE_DEPENDENCY_REASON)
    {
        task.status = "blocked".into();
        task.blocked_reason = Some(STALE_DEPENDENCY_REASON.into());
    }
}

pub(crate) fn refresh_task_run_gates(world: &mut World, task_id: &str) {
    if task_has_stale_dependency(world, task_id) {
        apply_stale_dependency_hold(world, task_id);
        return;
    }
    let unresolved = unresolved_blocker_ids(world, task_id);
    if unresolved.is_empty() {
        if let Some(task) = world.task_mut(task_id) {
            if task.blocked_reason.as_deref() == Some(ISSUE_BLOCKER_REASON)
                || task.blocked_reason.as_deref() == Some(STALE_DEPENDENCY_REASON)
            {
                if task.status == "blocked" {
                    task.status = "open".into();
                }
                task.blocked_reason = None;
            }
        }
        return;
    }
    sync_issue_blocker_hold(world, task_id);
}

pub(crate) fn status_needs_clear_blockers(status: &str) -> bool {
    matches!(status, "running" | "review" | "done")
}

/// Waiting tasks that had `blocker_id` as a blocker and have no other unfinished blockers.
pub(crate) fn refresh_issue_blocker_dependents(world: &mut World, blocker_id: &str) -> Vec<String> {
    let dependents = issue_blocking_ids(world, blocker_id);
    let mut released = Vec::new();
    for task_id in dependents {
        if waiting_task_would_release(world, &task_id, blocker_id) {
            released.push(task_id.clone());
        }
        sync_issue_blocker_hold(world, &task_id);
    }
    released
}

pub(crate) fn waiting_task_would_release(
    world: &World,
    waiting_id: &str,
    cleared_blocker_id: &str,
) -> bool {
    let blockers = issue_blocker_ids(world, waiting_id);
    if !blockers.iter().any(|id| id == cleared_blocker_id) {
        return false;
    }
    blockers
        .iter()
        .all(|id| id == cleared_blocker_id || issue_blocker_satisfied(world, id))
}

pub(crate) fn blocker_release_prompt(task: &Task) -> String {
    if task.description.trim().is_empty() {
        task.title.clone()
    } else {
        task.description.clone()
    }
}

pub(crate) fn workspace_conductor_id(world: &World, workspace_id: &str) -> Option<String> {
    world
        .workspace(workspace_id)
        .and_then(|ws| ws.conductor_agent_id.clone())
        .filter(|id| !id.is_empty())
}

pub(crate) fn is_conductor_review(
    world: &World,
    workspace_id: &str,
    agent_id: &str,
    trigger: &str,
) -> bool {
    trigger == "graph_review"
        && workspace_conductor_id(world, workspace_id).as_deref() == Some(agent_id)
}

pub(crate) fn can_reaffirm_dependency(world: &World, actor: &Actor, workspace_id: &str) -> bool {
    match actor {
        Actor::Daemon => true,
        Actor::Principal { .. } => actor_in_workspace(world, actor, workspace_id),
        Actor::Agent { id, .. } => {
            actor_in_workspace(world, actor, workspace_id)
                && workspace_conductor_id(world, workspace_id).as_deref() == Some(id.as_str())
        }
    }
}

pub(crate) fn graph_ready_prompt(task: &Task) -> String {
    blocker_release_prompt(task)
}

pub(crate) fn graph_replan_prompt(task: &Task) -> String {
    let body = graph_ready_prompt(task);
    format!("上游依赖刚被确认仍有效。请按当前事项重规划后再做，不要空跑上一轮 prompt。\n\n{body}")
}

pub(crate) fn conductor_review_prompt(
    task: &Task,
    changer_id: &str,
    entity: &str,
    edges: &[(String, String, String, u64)],
) -> String {
    let lines = edges
        .iter()
        .map(|(id, source_id, edge_entity, generation)| {
            format!("- {id} @ generation {generation} → {source_id}（{edge_entity}）")
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "工作区图总管：下游事项的依赖已失效，请决定是否放行。\n\n事项：{}（{}）\n打脏来源：{changer_id} 的 {entity} 变更。\n失效依赖：\n{lines}\n若批准下游继续，请用助手消息单独一行写出前缀 REAFFIRM、冒号和上列依赖 id。\n若应继续挡住，写出前缀 HOLD、冒号和依赖 id，或不批准。\n不要代替执行者改代码。",
        task.title, task.id
    )
}

pub(crate) fn task_ready_for_graph_dispatch(world: &World, task_id: &str) -> bool {
    let Some(task) = world.task(task_id) else {
        return false;
    };
    if task.deleted || matches!(task.status.as_str(), "backlog" | "done" | "cancelled") {
        return false;
    }
    if task.status == "blocked" || task.blocked_reason.is_some() {
        return false;
    }
    let has_agent = task
        .assignee_agent_id
        .as_deref()
        .map(|id| !id.is_empty())
        .unwrap_or(false);
    let has_squad = task
        .assignee_squad_id
        .as_deref()
        .map(|id| !id.is_empty())
        .unwrap_or(false);
    if !has_agent && !has_squad {
        return false;
    }
    if !unresolved_blocker_ids(world, task_id).is_empty() {
        return false;
    }
    if task_has_stale_dependency(world, task_id) {
        return false;
    }
    !world.runs.iter().any(|run| {
        run.task_id == task_id
            && run.status == "running"
            && !is_conductor_review(world, &task.workspace_id, &run.agent_id, &run.trigger)
    })
}

pub(crate) fn graph_successor_task_ids(world: &World, task_id: &str) -> Vec<String> {
    let mut ids = issue_blocking_ids(world, task_id);
    for dep in &world.dependencies {
        if dep.kind == GraphEdgeKind::Consumes
            && dep.source.id == task_id
            && dep.state != GraphEdgeState::Superseded
        {
            ids.push(dep.target.id.clone());
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

pub(crate) fn should_review_stale_consumer(world: &World, task_id: &str) -> bool {
    let Some(task) = world.task(task_id) else {
        return false;
    };
    if task.deleted || matches!(task.status.as_str(), "backlog" | "done" | "cancelled") {
        return false;
    }
    let graph_stale = task.blocked_reason.as_deref() == Some(STALE_DEPENDENCY_REASON);
    if task.blocked_reason.is_some() && !graph_stale {
        return false;
    }
    if task.status == "blocked" && !graph_stale {
        return false;
    }
    workspace_conductor_id(world, &task.workspace_id).is_some()
}

fn sync_issue_blocker_hold(world: &mut World, task_id: &str) {
    let unresolved = unresolved_blocker_ids(world, task_id);
    let Some(task) = world.task_mut(task_id) else {
        return;
    };
    if unresolved.is_empty() {
        if task.blocked_reason.as_deref() == Some(ISSUE_BLOCKER_REASON) {
            if task.status == "blocked" {
                task.status = "open".into();
            }
            task.blocked_reason = None;
        }
        return;
    }
    if task.status == "done" || task.status == "cancelled" || task.deleted {
        return;
    }
    if task.blocked_reason.is_none() || task.blocked_reason.as_deref() == Some(ISSUE_BLOCKER_REASON)
    {
        task.status = "blocked".into();
        task.blocked_reason = Some(ISSUE_BLOCKER_REASON.into());
    }
}

pub(crate) fn add_issue_blocker(
    world: &mut World,
    actor: &Actor,
    task_id: &str,
    blocker_id: &str,
) -> Result<Outcome, CoordyError> {
    let task = world
        .task(task_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("task"))?;
    require_member(world, actor, &task.workspace_id)?;
    if task.deleted {
        return Err(CoordyError::invalid("task is deleted"));
    }
    let blocker = world
        .task(blocker_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("blocker"))?;
    if blocker.deleted {
        return Err(CoordyError::invalid("blocker is deleted"));
    }
    if blocker.workspace_id != task.workspace_id {
        return Err(CoordyError::invalid(
            "blocker must be in the same workspace",
        ));
    }
    if task_id == blocker_id {
        return Err(CoordyError::invalid("事项不能把自己设为前置"));
    }
    if issue_graph_reaches(world, task_id, blocker_id) {
        return Err(CoordyError::invalid("前置事项不能形成循环"));
    }
    if world
        .issue_blockers
        .iter()
        .any(|edge| edge.task_id == task_id && edge.blocker_id == blocker_id)
    {
        return Ok(Outcome::ok(
            "blocker already recorded",
            json!({ "task_id": task_id, "blocker_id": blocker_id }),
        ));
    }
    let id = ids::new("blk");
    world.issue_blockers.push(IssueBlockerEdge {
        id: id.clone(),
        workspace_id: task.workspace_id.clone(),
        task_id: task_id.to_string(),
        blocker_id: blocker_id.to_string(),
    });
    sync_issue_blocker_hold(world, task_id);
    emit_changed(world, task.workspace_id);
    Ok(Outcome::ok(
        "blocker recorded",
        json!({ "blocker_edge_id": id, "task_id": task_id, "blocker_id": blocker_id }),
    ))
}

fn remove_issue_blocker(
    world: &mut World,
    actor: &Actor,
    task_id: &str,
    blocker_id: &str,
) -> Result<Outcome, CoordyError> {
    let task = world
        .task(task_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("task"))?;
    require_member(world, actor, &task.workspace_id)?;
    let before = world.issue_blockers.len();
    let released = if waiting_task_would_release(world, task_id, blocker_id) {
        vec![task_id.to_string()]
    } else {
        Vec::new()
    };
    world
        .issue_blockers
        .retain(|edge| !(edge.task_id == task_id && edge.blocker_id == blocker_id));
    if world.issue_blockers.len() == before {
        return Err(CoordyError::not_found("blocker"));
    }
    sync_issue_blocker_hold(world, task_id);
    emit_changed(world, task.workspace_id);
    Ok(Outcome::ok(
        "blocker removed",
        json!({
            "task_id": task_id,
            "blocker_id": blocker_id,
            "released_task_ids": released,
        }),
    ))
}

pub(crate) fn record_graph_event(
    world: &mut World,
    workspace_id: &str,
    kind: &str,
    edge_id: Option<&str>,
    node_id: Option<&str>,
    payload: serde_json::Value,
) {
    world.graph_revision = world.graph_revision.saturating_add(1);
    world.graph_events.push(crate::world::GraphEvent {
        id: ids::new("gev"),
        workspace_id: workspace_id.to_string(),
        kind: kind.into(),
        at: ids::now(),
        edge_id: edge_id.map(str::to_string),
        node_id: node_id.map(str::to_string),
        payload,
    });
    crate::runtime::Kernel::emit_effect(
        world,
        Effect::GraphDelta {
            workspace_id: workspace_id.to_string(),
            revision: world.graph_revision,
            cursor: world.effects.len() as u64,
        },
    );
}

pub(crate) fn bump_node_artifact(world: &mut World, workspace_id: &str, node_id: &str) -> u64 {
    let next = world.node_artifacts.get(node_id).copied().unwrap_or(0) + 1;
    world.node_artifacts.insert(node_id.to_string(), next);
    record_graph_event(
        world,
        workspace_id,
        "artifact_bumped",
        None,
        Some(node_id),
        json!({ "revision": next }),
    );
    next
}

pub(crate) fn mark_node_succeeded(world: &mut World, workspace_id: &str, node_id: &str) {
    let revision = world.node_artifacts.get(node_id).copied().unwrap_or(0);
    upsert_materialization(
        world,
        workspace_id,
        NodeRef::task(node_id),
        GraphEdgeState::Active,
        revision,
    );
    let fingerprint = {
        let snap = crate::graph::state_from_world(world, workspace_id);
        crate::graph::input_fingerprint(&snap, node_id)
    };
    record_graph_event(
        world,
        workspace_id,
        "task_succeeded",
        None,
        Some(node_id),
        json!({ "revision": revision, "input_fingerprint": fingerprint }),
    );
}

pub(crate) fn stale_done_materialization(world: &mut World, task_id: &str) {
    let Some(task) = world.task(task_id) else {
        return;
    };
    if task.status != "done" && task.status != "cancelled" {
        return;
    }
    let workspace_id = task.workspace_id.clone();
    let revision = world.node_artifacts.get(task_id).copied().unwrap_or(0);
    upsert_materialization(
        world,
        &workspace_id,
        NodeRef::task(task_id),
        GraphEdgeState::Stale,
        revision,
    );
}

fn upsert_materialization(
    world: &mut World,
    workspace_id: &str,
    node: NodeRef,
    state: GraphEdgeState,
    artifact_revision: u64,
) {
    let now = ids::now();
    if let Some(row) = world
        .materializations
        .iter_mut()
        .find(|row| row.node.id == node.id && row.workspace_id == workspace_id)
    {
        row.state = state;
        row.artifact_revision = artifact_revision;
        row.updated_at = now;
        return;
    }
    world.materializations.push(NodeMaterialization {
        workspace_id: workspace_id.to_string(),
        node,
        state,
        artifact_revision,
        updated_at: now,
    });
}

fn node_workspace_id(world: &World, node: &NodeRef) -> Option<String> {
    match node.kind {
        NodeKind::Task => world.task(&node.id).map(|task| task.workspace_id.clone()),
        NodeKind::Agent => world
            .agent(&node.id)
            .map(|agent| agent.workspace_id.clone()),
        NodeKind::Contract => world
            .contracts
            .iter()
            .find(|contract| contract.id == node.id)
            .map(|contract| contract.workspace_id.clone()),
    }
}

fn node_exists(world: &World, node: &NodeRef) -> bool {
    match node.kind {
        NodeKind::Task => world
            .task(&node.id)
            .map(|task| !task.deleted)
            .unwrap_or(false),
        NodeKind::Agent => world
            .agent(&node.id)
            .map(|agent| !agent.archived)
            .unwrap_or(false),
        NodeKind::Contract => world
            .contracts
            .iter()
            .any(|contract| contract.id == node.id),
    }
}

pub(crate) fn resolve_node_in_workspace(
    world: &World,
    workspace_id: &str,
    id: &str,
) -> Result<NodeRef, CoordyError> {
    if let Some(task) = world.task(id) {
        if task.deleted {
            return Err(CoordyError::invalid("依赖端点不存在"));
        }
        if task.workspace_id != workspace_id {
            return Err(CoordyError::invalid("依赖端点不能跨工作区"));
        }
        return Ok(NodeRef::task(id));
    }
    if let Some(agent) = world.agent(id) {
        if agent.archived {
            return Err(CoordyError::invalid("依赖端点不存在"));
        }
        if agent.workspace_id != workspace_id {
            return Err(CoordyError::invalid("依赖端点不能跨工作区"));
        }
        return Ok(NodeRef::agent(id));
    }
    if let Some(contract) = world.contracts.iter().find(|contract| contract.id == id) {
        if contract.workspace_id != workspace_id {
            return Err(CoordyError::invalid("依赖端点不能跨工作区"));
        }
        return Ok(NodeRef::contract(id));
    }
    Err(CoordyError::invalid("依赖端点不存在"))
}

fn verify_node_ref(
    world: &World,
    workspace_id: &str,
    node: NodeRef,
) -> Result<NodeRef, CoordyError> {
    if node.id.trim().is_empty() {
        return Err(CoordyError::invalid("dependency endpoints are required"));
    }
    if node_exists(world, &node) {
        return match node_workspace_id(world, &node) {
            Some(ws) if ws == workspace_id => Ok(node),
            Some(_) => Err(CoordyError::invalid("依赖端点不能跨工作区")),
            None => Err(CoordyError::invalid("依赖端点不存在")),
        };
    }
    let other_ws = world
        .task(&node.id)
        .map(|task| task.workspace_id.clone())
        .or_else(|| {
            world
                .agent(&node.id)
                .map(|agent| agent.workspace_id.clone())
        })
        .or_else(|| {
            world
                .contracts
                .iter()
                .find(|contract| contract.id == node.id)
                .map(|contract| contract.workspace_id.clone())
        });
    match other_ws {
        Some(ws) if ws != workspace_id => Err(CoordyError::invalid("依赖端点不能跨工作区")),
        _ => Err(CoordyError::invalid("依赖端点不存在")),
    }
}

fn resolve_declare_refs(
    world: &World,
    workspace_id: &str,
    source: Option<NodeRef>,
    target: Option<NodeRef>,
    from_id: &str,
    to_id: &str,
) -> Result<(NodeRef, NodeRef), CoordyError> {
    let source = if let Some(node) = source {
        verify_node_ref(world, workspace_id, node)?
    } else if !to_id.trim().is_empty() {
        resolve_node_in_workspace(world, workspace_id, to_id.trim())?
    } else {
        return Err(CoordyError::invalid("dependency endpoints are required"));
    };
    let target = if let Some(node) = target {
        verify_node_ref(world, workspace_id, node)?
    } else if !from_id.trim().is_empty() {
        resolve_node_in_workspace(world, workspace_id, from_id.trim())?
    } else {
        return Err(CoordyError::invalid("dependency endpoints are required"));
    };
    Ok((source, target))
}

fn declare_kind_supported(kind: &GraphEdgeKind) -> bool {
    matches!(
        kind,
        GraphEdgeKind::Consumes | GraphEdgeKind::Precedence | GraphEdgeKind::AssignedTo
    )
}

pub(crate) struct GraphEdgeDraft {
    pub source: NodeRef,
    pub target: NodeRef,
    pub kind: GraphEdgeKind,
    pub entity: String,
    pub reason: Option<String>,
    pub origin_run_id: Option<String>,
    pub selector_path: Option<String>,
}

pub(crate) struct DeclareDependencyRequest {
    pub workspace_id: String,
    pub source: Option<NodeRef>,
    pub target: Option<NodeRef>,
    pub from_id: String,
    pub to_id: String,
    pub kind: GraphEdgeKind,
    pub entity: String,
    pub reason: Option<String>,
    pub origin_run_id: Option<String>,
    pub selector_path: Option<String>,
}

pub(crate) fn record_dependency_edge(
    world: &mut World,
    actor: &Actor,
    workspace_id: &str,
    draft: GraphEdgeDraft,
) -> Result<Outcome, CoordyError> {
    if draft.source.id.trim().is_empty() || draft.target.id.trim().is_empty() {
        return Err(CoordyError::invalid("dependency endpoints are required"));
    }
    if draft.source.id == draft.target.id {
        return Err(CoordyError::invalid("依赖不能指向自己"));
    }
    if !declare_kind_supported(&draft.kind) {
        return Err(CoordyError::invalid("尚未支持该依赖类型"));
    }
    let entity = if draft.entity.trim().is_empty() {
        "repo"
    } else {
        draft.entity.trim()
    };
    if let Some(existing) = world.dependencies.iter().find(|dep| {
        dep.workspace_id == workspace_id
            && dep.source.id == draft.source.id
            && dep.target.id == draft.target.id
            && dep.kind == draft.kind
            && dep.entity == entity
            && dep.state != GraphEdgeState::Superseded
    }) {
        return Ok(Outcome::ok(
            "dependency already recorded",
            json!({ "dependency_id": existing.id }),
        ));
    }
    if issue_graph_reaches(world, &draft.target.id, &draft.source.id) {
        return Err(CoordyError::invalid("依赖不能形成循环"));
    }
    let version = world
        .node_artifacts
        .get(&draft.source.id)
        .copied()
        .unwrap_or(0);
    let id = ids::new("dep");
    let created_at = ids::now();
    world.dependencies.push(GraphEdge {
        id: id.clone(),
        workspace_id: workspace_id.to_string(),
        source: draft.source.clone(),
        target: draft.target.clone(),
        kind: draft.kind.clone(),
        entity: entity.to_string(),
        state: GraphEdgeState::Active,
        generation: 1,
        origin_run_id: draft.origin_run_id.clone(),
        actor_id: Some(actor.id().to_string()),
        reason: draft.reason.clone(),
        source_event: Some("declare".into()),
        created_at,
        selector_path: draft.selector_path.clone(),
        observed_version: Some(version),
        current_version: Some(version),
    });
    record_graph_event(
        world,
        workspace_id,
        "declare",
        Some(&id),
        Some(&draft.target.id),
        json!({
            "source": draft.source.id,
            "target": draft.target.id,
            "source_kind": draft.source.kind,
            "target_kind": draft.target.kind,
            "kind": draft.kind,
            "entity": entity,
            "origin_run_id": draft.origin_run_id,
            "observed_version": version,
            "current_version": version,
        }),
    );
    emit_changed(world, workspace_id.to_string());
    Ok(Outcome::ok(
        "dependency recorded",
        json!({ "dependency_id": id }),
    ))
}

pub(crate) fn declare_dependency(
    world: &mut World,
    actor: &Actor,
    request: DeclareDependencyRequest,
) -> Result<Outcome, CoordyError> {
    if !actor_in_workspace(world, actor, &request.workspace_id) && !matches!(actor, Actor::Daemon) {
        return Err(CoordyError::denied("not in workspace"));
    }
    let (source, target) = resolve_declare_refs(
        world,
        &request.workspace_id,
        request.source,
        request.target,
        &request.from_id,
        &request.to_id,
    )?;
    if request.origin_run_id.is_some() {
        return Err(CoordyError::invalid(
            "origin run is reserved for internally observed dependencies",
        ));
    }
    record_dependency_edge(
        world,
        actor,
        &request.workspace_id,
        GraphEdgeDraft {
            source,
            target,
            kind: request.kind,
            entity: request.entity,
            reason: request.reason,
            origin_run_id: request.origin_run_id,
            selector_path: request.selector_path,
        },
    )
}

pub(crate) fn reaffirm_dependency(
    world: &mut World,
    actor: &Actor,
    dependency_id: &str,
    expected_generation: u64,
) -> Result<Outcome, CoordyError> {
    require_not_agent(actor)?;
    let dep = world
        .dependencies
        .iter()
        .find(|dep| dep.id == dependency_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("dependency"))?;
    if !can_reaffirm_dependency(world, actor, &dep.workspace_id) {
        return Err(CoordyError::denied(
            "only a member, daemon, or workspace conductor may reaffirm",
        ));
    }
    if dep.generation != expected_generation {
        record_graph_event(
            world,
            &dep.workspace_id,
            "generation_rejected",
            Some(dependency_id),
            Some(&dep.target.id),
            json!({
                "expected": expected_generation,
                "actual": dep.generation,
            }),
        );
        return Err(CoordyError::invalid("dependency generation mismatch"));
    }
    if let Some(row) = world
        .dependencies
        .iter_mut()
        .find(|d| d.id == dependency_id)
    {
        row.state = GraphEdgeState::Active;
        row.observed_version = row.current_version;
        row.actor_id = Some(actor.id().to_string());
        row.source_event = Some("reaffirm".into());
    }
    for conflict in world.conflicts.iter_mut() {
        if conflict.status == "open" && conflict.summary.contains(dependency_id) {
            conflict.status = "resolved".into();
        }
    }
    record_graph_event(
        world,
        &dep.workspace_id,
        "reaffirm",
        Some(dependency_id),
        Some(&dep.target.id),
        json!({ "generation": expected_generation }),
    );
    refresh_task_run_gates(world, &dep.target.id);
    emit_changed(world, dep.workspace_id);
    Ok(Outcome::ok(
        "dependency reaffirmed",
        json!({ "dependency_id": dependency_id, "task_id": dep.target.id }),
    ))
}

pub(crate) fn remove_dependency(
    world: &mut World,
    actor: &Actor,
    dependency_id: &str,
) -> Result<Outcome, CoordyError> {
    require_not_agent(actor)?;
    let dep = world
        .dependencies
        .iter()
        .find(|dep| dep.id == dependency_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("dependency"))?;
    if !actor_in_workspace(world, actor, &dep.workspace_id) && !matches!(actor, Actor::Daemon) {
        return Err(CoordyError::denied("not in workspace"));
    }
    world.dependencies.retain(|edge| edge.id != dependency_id);
    record_graph_event(
        world,
        &dep.workspace_id,
        "remove",
        Some(dependency_id),
        Some(&dep.target.id),
        json!({}),
    );
    refresh_task_run_gates(world, &dep.target.id);
    emit_changed(world, dep.workspace_id);
    Ok(Outcome::ok(
        "dependency removed",
        json!({ "dependency_id": dependency_id, "task_id": dep.target.id }),
    ))
}

pub(crate) fn set_workspace_conductor(
    world: &mut World,
    actor: &Actor,
    workspace_id: &str,
    agent_id: Option<String>,
) -> Result<Outcome, CoordyError> {
    require_not_agent(actor)?;
    require_member(world, actor, workspace_id)?;
    if let Some(agent_id) = agent_id.as_ref() {
        let Some(agent) = world.agent(agent_id) else {
            return Err(CoordyError::not_found("agent"));
        };
        if agent.workspace_id != workspace_id {
            return Err(CoordyError::invalid("agent/workspace mismatch"));
        }
        if agent.archived {
            return Err(CoordyError::invalid(
                "conductor cannot be an archived agent",
            ));
        }
    }
    let Some(ws) = world.workspaces.iter_mut().find(|ws| ws.id == workspace_id) else {
        return Err(CoordyError::not_found("workspace"));
    };
    ws.conductor_agent_id = agent_id.clone();
    emit_changed(world, workspace_id.to_string());
    Ok(Outcome::ok(
        "conductor updated",
        json!({ "workspace_id": workspace_id, "agent_id": agent_id }),
    ))
}

fn validator_role_ok(role: &RunRole) -> bool {
    matches!(role, RunRole::ConductorReview | RunRole::HumanApproval)
}

pub(crate) fn apply_validation_decision(
    world: &mut World,
    actor: &Actor,
    dependency_id: &str,
    expected_generation: u64,
    decision: ValidationChoice,
    evidence_refs: Vec<String>,
    rationale: String,
    validator_run_id: Option<String>,
) -> Result<Outcome, CoordyError> {
    let dep = world
        .dependencies
        .iter()
        .find(|dep| dep.id == dependency_id)
        .cloned()
        .ok_or_else(|| CoordyError::not_found("dependency"))?;
    if let Some(run_id) = validator_run_id.as_ref() {
        if !matches!(actor, Actor::Daemon) {
            return Err(CoordyError::denied(
                "only the daemon may submit a run-backed validation decision",
            ));
        }
        let Some(run) = world.run(run_id) else {
            return Err(CoordyError::not_found("run"));
        };
        if !validator_role_ok(&run.role) {
            return Err(CoordyError::denied(
                "validator run role must be conductor_review or human_approval",
            ));
        }
        if run.workspace_id != dep.workspace_id || run.task_id != dep.target.id {
            return Err(CoordyError::denied(
                "validator run does not belong to this dependency target",
            ));
        }
        let expected_fingerprint = format!("validate:{dependency_id}:{expected_generation}");
        let bound_attempt = world.node_attempts.iter().any(|attempt| {
            attempt.run_id.as_deref() == Some(run_id.as_str())
                && attempt.workspace_id == dep.workspace_id
                && attempt.node_id == dep.target.id
                && attempt.role == run.role
                && attempt.input_fingerprint == expected_fingerprint
                && matches!(attempt.lease_status.as_str(), "claimed" | "running")
        });
        if !bound_attempt {
            return Err(CoordyError::denied(
                "validator run is not actively bound to this dependency generation",
            ));
        }
    } else if actor.is_agent() {
        return Err(CoordyError::denied(
            "executor cannot submit a validation decision",
        ));
    }
    if !actor_in_workspace(world, actor, &dep.workspace_id) && !matches!(actor, Actor::Daemon) {
        return Err(CoordyError::denied("not in workspace"));
    }
    if dep.generation != expected_generation {
        return Err(CoordyError::invalid("dependency generation mismatch"));
    }
    if let Some(run_id) = validator_run_id.as_deref() {
        if let Some(node_id) = crate::graph::schedule::complete_attempt_for_run(world, run_id, true)
        {
            record_graph_event(
                world,
                &dep.workspace_id,
                "attempt_completed",
                None,
                Some(&node_id),
                json!({
                    "run_id": run_id,
                    "ok": true,
                    "reason": "validation_decision",
                }),
            );
        }
    }
    record_graph_event(
        world,
        &dep.workspace_id,
        "validation_decision",
        Some(dependency_id),
        Some(&dep.target.id),
        json!({
            "decision": decision,
            "expected_generation": expected_generation,
            "actual_generation": dep.generation,
            "evidence_refs": evidence_refs,
            "rationale": rationale,
            "validator_run_id": validator_run_id,
        }),
    );
    match decision {
        ValidationChoice::Reaffirm => {
            reaffirm_dependency(world, actor, dependency_id, expected_generation)
        }
        ValidationChoice::Remove => remove_dependency(world, actor, dependency_id),
        ValidationChoice::Hold | ValidationChoice::Replan => {
            let next_state = if decision == ValidationChoice::Hold {
                GraphEdgeState::PendingValidation
            } else {
                GraphEdgeState::Rejected
            };
            if let Some(row) = world
                .dependencies
                .iter_mut()
                .find(|row| row.id == dependency_id)
            {
                row.state = next_state.clone();
                row.actor_id = Some(actor.id().to_string());
                row.source_event = Some(format!("validation:{decision:?}"));
            }
            if decision == ValidationChoice::Replan {
                push_notice(
                    world,
                    &dep.workspace_id,
                    "replan",
                    "Replan required",
                    STALE_DEPENDENCY_REASON,
                    Some(dep.target.id.clone()),
                );
            }
            refresh_task_run_gates(world, &dep.target.id);
            emit_changed(world, dep.workspace_id.clone());
            Ok(Outcome::ok(
                "validation recorded",
                json!({
                    "dependency_id": dependency_id,
                    "state": next_state,
                    "task_id": dep.target.id,
                }),
            ))
        }
    }
}

pub(crate) fn build_review_packet(world: &World, edge_id: &str) -> Option<ReviewPacket> {
    let edge = world.dependencies.iter().find(|edge| edge.id == edge_id)?;
    let invalidation = world
        .graph_events
        .iter()
        .rev()
        .find(|event| event.edge_id.as_deref() == Some(edge_id) && event.kind == "invalidate")
        .map(|event| event.id.clone());
    let worktree = world
        .task(&edge.source.id)
        .and_then(|task| task.worktree_path.clone())
        .filter(|path| !path.is_empty())
        .or_else(|| {
            world
                .task(&edge.target.id)
                .and_then(|task| task.worktree_path.clone())
                .filter(|path| !path.is_empty())
        });
    let consumer_plan = world
        .commitments
        .iter()
        .rev()
        .find(|row| {
            row.task_id.as_deref() == Some(edge.target.id.as_str())
                && row.commitment_type == "PLAN"
                && row.status == "ACTIVE"
        })
        .map(|row| row.claim.clone())
        .or_else(|| {
            world
                .task(&edge.target.id)
                .map(|task| task.description.clone())
        })
        .unwrap_or_default();
    Some(ReviewPacket {
        dependency_id: edge.id.clone(),
        reason: edge
            .reason
            .clone()
            .unwrap_or_else(|| STALE_DEPENDENCY_REASON.into()),
        invalidation_event: invalidation,
        old_version: edge.observed_version,
        new_version: edge.current_version,
        changed_files: Vec::new(),
        diff_ref: worktree.clone(),
        diff_missing_reason: if worktree.is_none() {
            Some("worktree not readable".into())
        } else {
            None
        },
        consumer_plan,
        deterministic_checks: Vec::new(),
        generation: edge.generation,
    })
}

pub(crate) fn review_prompt(packet: &ReviewPacket) -> String {
    let body = serde_json::to_string_pretty(packet).unwrap_or_else(|_| "{}".into());
    format!(
        "# ReviewPacket\n\n```json\n{body}\n```\n\n用一行结构化决定回复，必须带当前 generation（{generation}）：\n`REAFFIRM: <dependency_id> generation=<generation>`\n`HOLD: <dependency_id> generation=<generation>`\n`REMOVE: <dependency_id> generation=<generation>`\n`REPLAN: <dependency_id> generation=<generation>`",
        generation = packet.generation
    )
}

pub(crate) fn dependency_view(dep: &GraphEdge) -> DependencyView {
    DependencyView {
        id: dep.id.clone(),
        source: dep.source.clone(),
        target: dep.target.clone(),
        entity: dep.entity.clone(),
        kind: dep.kind.clone(),
        state: dep.state.clone(),
        generation: dep.generation,
        origin_run_id: dep.origin_run_id.clone(),
        actor_id: dep.actor_id.clone(),
        reason: dep.reason.clone(),
        selector_path: dep.selector_path.clone(),
        observed_version: dep.observed_version,
        current_version: dep.current_version,
        from_id: dep.target.id.clone(),
        to_id: dep.source.id.clone(),
        valid: dep.valid(),
    }
}

fn graph_edge_view(dep: &GraphEdge) -> GraphEdgeView {
    GraphEdgeView {
        id: dep.id.clone(),
        workspace_id: dep.workspace_id.clone(),
        source: dep.source.clone(),
        target: dep.target.clone(),
        kind: dep.kind.clone(),
        entity: dep.entity.clone(),
        state: dep.state.clone(),
        generation: dep.generation,
        origin_run_id: dep.origin_run_id.clone(),
        actor_id: dep.actor_id.clone(),
        reason: dep.reason.clone(),
        source_event: dep.source_event.clone(),
        created_at: dep.created_at.clone(),
        selector_path: dep.selector_path.clone(),
        observed_version: dep.observed_version,
        current_version: dep.current_version,
        valid: dep.valid(),
    }
}

fn synthetic_edge(
    id: String,
    workspace_id: &str,
    source: NodeRef,
    target: NodeRef,
    kind: GraphEdgeKind,
    entity: &str,
) -> GraphEdgeView {
    GraphEdgeView {
        id,
        workspace_id: workspace_id.to_string(),
        source,
        target,
        kind,
        entity: entity.into(),
        state: GraphEdgeState::Active,
        generation: 0,
        origin_run_id: None,
        actor_id: None,
        reason: None,
        source_event: None,
        created_at: String::new(),
        selector_path: None,
        observed_version: None,
        current_version: None,
        valid: true,
    }
}

fn task_has_replan(world: &World, task_id: &str) -> bool {
    task_has_stale_dependency(world, task_id)
        || world.runs.iter().any(|run| {
            run.task_id == task_id && (run.status == "paused" || run.queue_status == "paused")
        })
}

fn agent_status(world: &World, agent_id: &str) -> (String, bool) {
    let replan = world.tasks.iter().any(|task| {
        task.assignee_agent_id.as_deref() == Some(agent_id) && task_has_replan(world, &task.id)
    }) || world.runs.iter().any(|run| {
        run.agent_id == agent_id && (run.status == "paused" || run.queue_status == "paused")
    });
    let running = world.runs.iter().any(|run| {
        run.agent_id == agent_id && (run.status == "running" || run.queue_status == "running")
    });
    let status = if running {
        "running"
    } else if replan {
        "paused"
    } else {
        "idle"
    };
    (status.into(), replan)
}

pub(crate) fn graph_snapshot(
    world: &World,
    workspace_id: &str,
) -> (
    u64,
    u64,
    Vec<GraphNodeView>,
    Vec<GraphEdgeView>,
    Vec<NodeMaterializationView>,
    GraphHealthView,
) {
    let mut nodes = Vec::new();
    for task in world
        .tasks
        .iter()
        .filter(|task| task.workspace_id == workspace_id && !task.deleted)
    {
        nodes.push(GraphNodeView {
            id: task.id.clone(),
            kind: NodeKind::Task,
            title: task.title.clone(),
            status: task.status.clone(),
            workspace_id: task.workspace_id.clone(),
            subtitle: if task.identifier.is_empty() {
                String::new()
            } else {
                task.identifier.clone()
            },
            assignee_agent_id: task.assignee_agent_id.clone(),
            blocked_reason: task.blocked_reason.clone(),
            replan: task_has_replan(world, &task.id),
            harness: String::new(),
        });
    }
    for agent in world
        .agents
        .iter()
        .filter(|agent| agent.workspace_id == workspace_id && !agent.archived)
    {
        let (status, replan) = agent_status(world, &agent.id);
        nodes.push(GraphNodeView {
            id: agent.id.clone(),
            kind: NodeKind::Agent,
            title: agent.name.clone(),
            status,
            workspace_id: agent.workspace_id.clone(),
            subtitle: agent.harness.clone(),
            assignee_agent_id: None,
            blocked_reason: None,
            replan,
            harness: agent.harness.clone(),
        });
    }
    for contract in world
        .contracts
        .iter()
        .filter(|contract| contract.workspace_id == workspace_id)
    {
        nodes.push(GraphNodeView {
            id: contract.id.clone(),
            kind: NodeKind::Contract,
            title: contract.title.clone(),
            status: contract.status.clone(),
            workspace_id: contract.workspace_id.clone(),
            subtitle: "契约".into(),
            assignee_agent_id: None,
            blocked_reason: None,
            replan: false,
            harness: String::new(),
        });
    }

    let mut edges = Vec::new();
    for task in world
        .tasks
        .iter()
        .filter(|task| task.workspace_id == workspace_id && !task.deleted)
    {
        if let Some(agent_id) = task
            .assignee_agent_id
            .as_deref()
            .filter(|id| !id.is_empty())
        {
            edges.push(synthetic_edge(
                format!("assigned:{agent_id}:{}", task.id),
                workspace_id,
                NodeRef::agent(agent_id),
                NodeRef::task(&task.id),
                GraphEdgeKind::AssignedTo,
                "assignment",
            ));
        }
    }
    for blocker in world
        .issue_blockers
        .iter()
        .filter(|edge| edge.workspace_id == workspace_id)
    {
        edges.push(synthetic_edge(
            format!("blocker:{}:{}", blocker.blocker_id, blocker.task_id),
            workspace_id,
            NodeRef::task(&blocker.blocker_id),
            NodeRef::task(&blocker.task_id),
            GraphEdgeKind::Precedence,
            "issue",
        ));
    }
    for dep in world
        .dependencies
        .iter()
        .filter(|dep| dep.workspace_id == workspace_id && dep.state != GraphEdgeState::Superseded)
    {
        edges.push(graph_edge_view(dep));
    }

    let materializations = world
        .materializations
        .iter()
        .filter(|row| row.workspace_id == workspace_id)
        .map(|row| NodeMaterializationView {
            node: row.node.clone(),
            workspace_id: row.workspace_id.clone(),
            state: row.state.clone(),
            artifact_revision: row.artifact_revision,
            updated_at: row.updated_at.clone(),
        })
        .collect();
    let event_cursor = world
        .effects
        .last()
        .map(|effect| effect.cursor)
        .unwrap_or(0);
    (
        world.graph_revision,
        event_cursor,
        nodes,
        edges,
        materializations,
        GraphHealthView {
            consistent: true,
            lag: 0,
        },
    )
}

pub(crate) fn graph_timeline(world: &World, workspace_id: &str) -> Vec<GraphTimelineEventView> {
    world
        .graph_events
        .iter()
        .filter(|event| event.workspace_id == workspace_id)
        .map(|event| GraphTimelineEventView {
            id: event.id.clone(),
            kind: event.kind.clone(),
            at: event.at.clone(),
            edge_id: event.edge_id.clone(),
            node_id: event.node_id.clone(),
            summary: timeline_summary(event),
        })
        .collect()
}

fn timeline_summary(event: &crate::world::GraphEvent) -> String {
    let source = event
        .payload
        .get("source")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let target = event
        .payload
        .get("target")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    match event.kind.as_str() {
        "declare" if !source.is_empty() && !target.is_empty() => {
            format!("声明 {source} → {target}")
        }
        "invalidate" => "失效".into(),
        "reaffirm" => "确认".into(),
        "validation_decision" => "验证决定".into(),
        "attempt_started" => "尝试开始".into(),
        "attempt_completed" => "尝试结束".into(),
        "task_succeeded" => "节点成功".into(),
        "artifact_bumped" => "产物版本递增".into(),
        "generation_rejected" => "代际拒绝".into(),
        "remove" => "移除依赖".into(),
        other => other.to_string(),
    }
}
