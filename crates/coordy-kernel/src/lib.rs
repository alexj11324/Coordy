//! Coordy kernel: the only deep business module.

mod authority;
mod jsonl;
mod memory;
mod ports;
mod runtime;
mod verification;
mod world;

pub mod ids {
    pub use crate::ports::{new, now};
}

pub use jsonl::read_jsonl;
pub use ports::{NoopPorts, Ports, RecordingPorts};
pub use runtime::{sync_batch, Kernel};
pub use world::World;

use coordy_protocol::{AuthenticatedCommand, AuthorizedQuery, CoordyError, Effect, Outcome, View};

pub trait CoordyKernel {
    fn submit(
        &self,
        command: AuthenticatedCommand,
    ) -> impl std::future::Future<Output = Result<Outcome, CoordyError>> + Send;

    fn view(
        &self,
        query: AuthorizedQuery,
    ) -> impl std::future::Future<Output = Result<View, CoordyError>> + Send;

    fn watch(&self, cursor: Option<u64>) -> Vec<Effect>;
}

impl CoordyKernel for Kernel {
    fn submit(
        &self,
        command: AuthenticatedCommand,
    ) -> impl std::future::Future<Output = Result<Outcome, CoordyError>> + Send {
        let outcome = self.submit_sync(command);
        async move { outcome }
    }

    fn view(
        &self,
        query: AuthorizedQuery,
    ) -> impl std::future::Future<Output = Result<View, CoordyError>> + Send {
        let view = self.view_sync(query);
        async move { view }
    }

    fn watch(&self, cursor: Option<u64>) -> Vec<Effect> {
        Kernel::watch(self, cursor)
    }
}

pub fn sync_omits_private_memory(world: &World) -> bool {
    let batch = sync_batch(world);
    batch["published_memory"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .all(|m| m["visibility"].as_str() == Some("shared"))
        })
        .unwrap_or(true)
}
