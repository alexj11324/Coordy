use coordy_protocol::Actor;

use crate::world::{MemoryRecord, World};

pub fn can_read(world: &World, actor: &Actor, mem: &MemoryRecord) -> bool {
    match mem.visibility.as_str() {
        "agent_private" => match actor {
            Actor::Agent { id, .. } => *id == mem.owner_actor_id,
            _ => false,
        },
        "principal" => match actor {
            Actor::Principal { id } => *id == mem.owner_actor_id,
            Actor::Agent { principal_id, .. } => *principal_id == mem.owner_actor_id,
            Actor::Daemon => false,
        },
        "shared" => {
            if mem.status == "proposed_share" {
                return match actor {
                    Actor::Principal { id } => {
                        mem.owner_actor_id == *id || mem.share_to.as_deref() == Some(id.as_str())
                    }
                    _ => false,
                };
            }
            mem.status == "shared"
                && crate::authority::actor_in_workspace(world, actor, &mem.workspace_id)
        }
        _ => false,
    }
}
