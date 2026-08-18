use crate::world::{Agent, Grant, World};
use coordy_protocol::Actor;

pub fn actor_in_workspace(world: &World, actor: &Actor, workspace_id: &str) -> bool {
    match actor {
        Actor::Daemon => true,
        Actor::Principal { id } => world
            .principal(id)
            .is_some_and(|p| p.workspace_id == workspace_id),
        Actor::Agent { id, .. } => world
            .agent(id)
            .is_some_and(|a| a.workspace_id == workspace_id),
    }
}

pub fn principal_owns_agent(world: &World, principal_id: &str, agent_id: &str) -> bool {
    world
        .agent(agent_id)
        .is_some_and(|a| a.principal_id == principal_id)
}

pub fn actor_controls_agent(_world: &World, actor: &Actor, agent: &Agent) -> bool {
    match actor {
        Actor::Daemon => true,
        Actor::Principal { id } => agent.principal_id == *id,
        Actor::Agent { id, .. } => agent.id == *id,
    }
}

fn resource_covers(grant_resource: &str, requested: &str) -> bool {
    grant_resource == "*"
        || grant_resource == requested
        || requested.starts_with(&format!("{grant_resource}/"))
        || (grant_resource.ends_with(":*")
            && requested.starts_with(&grant_resource[..grant_resource.len() - 1]))
}

fn action_covers(grant_action: &str, requested: &str) -> bool {
    grant_action == "*" || grant_action == requested
}

pub fn builtin_allows(world: &World, actor: &Actor, resource: &str, action: &str) -> bool {
    match actor {
        Actor::Daemon => {
            action == "bootstrap"
                || resource.starts_with("workspace:") && action == "create_principal"
        }
        Actor::Principal { id } => {
            if resource == format!("principal:{id}") {
                return true;
            }
            if let Some(agent_id) = resource.strip_prefix("agent:") {
                if principal_owns_agent(world, id, agent_id) {
                    return true;
                }
            }
            if resource.starts_with("workspace:") && (action == "read" || action == "write") {
                return world.principal(id).is_some();
            }
            false
        }
        Actor::Agent { id, principal_id } => {
            if resource == format!("agent:{id}") {
                return true;
            }
            if resource == format!("principal:{principal_id}") && action == "memory.read" {
                return true;
            }
            false
        }
    }
}

pub fn has_grant(world: &World, actor_id: &str, resource: &str, action: &str) -> bool {
    world.grants.iter().any(|g| {
        !g.revoked
            && g.grantee_id == actor_id
            && resource_covers(&g.resource, resource)
            && action_covers(&g.action, action)
    })
}

pub fn can(world: &World, actor: &Actor, resource: &str, action: &str) -> bool {
    if builtin_allows(world, actor, resource, action) {
        return true;
    }
    has_grant(world, actor.id(), resource, action)
}

pub fn grantor_holds(world: &World, grantor_id: &str, resource: &str, action: &str) -> bool {
    if world.principal(grantor_id).is_some() {
        if resource == format!("principal:{grantor_id}") {
            return true;
        }
        if let Some(agent_id) = resource.strip_prefix("agent:") {
            if principal_owns_agent(world, grantor_id, agent_id) {
                return true;
            }
        }
        if resource.starts_with("workspace:") {
            return true;
        }
    }
    has_grant(world, grantor_id, resource, action)
}

pub fn would_escalate(from: &Grant, resource: &str, action: &str) -> bool {
    if from.revoked {
        return true;
    }
    if from.action != "*" && action == "*" {
        return true;
    }
    if from.action != "*" && from.action != action {
        return true;
    }
    if from.resource == "*" {
        return false;
    }
    if resource == "*" && from.resource != "*" {
        return true;
    }
    !resource_covers(&from.resource, resource)
}

pub fn matching_held_grant<'a>(
    world: &'a World,
    grantor_id: &str,
    resource: &str,
    action: &str,
) -> Option<&'a Grant> {
    world.grants.iter().find(|g| {
        !g.revoked
            && g.grantee_id == grantor_id
            && resource_covers(&g.resource, resource)
            && action_covers(&g.action, action)
    })
}

pub fn can_command_agent(world: &World, actor: &Actor, agent_id: &str) -> bool {
    let Some(agent) = world.agent(agent_id) else {
        return false;
    };
    if actor_controls_agent(world, actor, agent) {
        return true;
    }
    can(world, actor, &format!("agent:{agent_id}"), "command")
}
