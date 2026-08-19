use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::thread;

use coordy_harness::{
    discover, kill_child, launch_uses_acp, resolve_launch, spawn_acp_session, spawn_native_session,
    SecretEnv,
};
use coordy_kernel::Ports;
use coordy_protocol::{CoordyError, HarnessEvent};

use crate::git::GitPorts;
use crate::secrets::SecretStore;

pub struct LivePorts {
    git: GitPorts,
    data_dir: PathBuf,
    events: Sender<(String, HarnessEvent)>,
}

impl LivePorts {
    pub fn new(data_dir: &Path, events: Sender<(String, HarnessEvent)>) -> Self {
        Self {
            git: GitPorts,
            data_dir: data_dir.to_path_buf(),
            events,
        }
    }
}

impl Ports for LivePorts {
    fn create_worktree(&self, repo: &str, task_id: &str) -> Result<String, CoordyError> {
        self.git.create_worktree(repo, task_id)
    }

    fn apply_patch(&self, worktree: &str, patch: &str) -> Result<(), CoordyError> {
        self.git.apply_patch(worktree, patch)
    }

    fn read_jsonl(&self, path: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
        self.git.read_jsonl(path)
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_harness(
        &self,
        kind: &str,
        worktree: &str,
        prompt: &str,
        run_id: &str,
        model: &str,
        thinking: &str,
        speed: &str,
        cli_args: &str,
        tool_access: &str,
    ) -> Result<(), CoordyError> {
        let tx = self.events.clone();
        let run_id = run_id.to_string();
        let kind = kind.to_string();
        let worktree = worktree.to_string();
        let prompt = prompt.to_string();
        let model = model.to_string();
        let thinking = thinking.to_string();
        let speed = speed.to_string();
        let cli_args = cli_args.to_string();
        let tool_access = tool_access.to_string();
        let secrets = SecretStore::open(&self.data_dir).env();
        let registry = std::fs::read_to_string(self.data_dir.join("cache/acp-registry.json")).ok();
        thread::spawn(move || {
            let emit = |event: HarnessEvent| {
                let _ = tx.send((run_id.clone(), event));
            };
            let result = run_kind(
                &kind,
                &worktree,
                &prompt,
                &model,
                &thinking,
                &speed,
                &cli_args,
                &tool_access,
                &run_id,
                &secrets,
                registry.as_deref(),
                emit,
            );
            let (output, exit_code) = match &result {
                Ok(()) => ("end_turn".to_string(), 0),
                Err(err) => {
                    let _ = tx.send((
                        run_id.clone(),
                        HarnessEvent::Message {
                            role: "system".into(),
                            content: err.to_string(),
                        },
                    ));
                    (err.to_string(), 1)
                }
            };
            let _ = tx.send((
                run_id,
                HarnessEvent::Tool {
                    name: coordy_protocol::HARNESS_SESSION_TOOL.into(),
                    input: kind,
                    output,
                    exit_code: Some(exit_code),
                },
            ));
        });
        Ok(())
    }

    fn cancel_harness(&self, run_id: &str) -> Result<(), CoordyError> {
        let _ = kill_child(run_id);
        Ok(())
    }
}

pub(crate) fn run_kind(
    kind: &str,
    worktree: &str,
    prompt: &str,
    model: &str,
    thinking: &str,
    speed: &str,
    cli_args: &str,
    tool_access: &str,
    run_id: &str,
    secrets: &SecretEnv,
    registry_json: Option<&str>,
    emit: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    let catalog = discover(registry_json);
    if launch_uses_acp(kind, &catalog) {
        let (bin, args) = resolve_launch(kind, secrets.acp_command.as_deref(), registry_json)?;
        return spawn_acp_session(
            kind,
            &bin,
            &args,
            worktree,
            prompt,
            model,
            thinking,
            secrets,
            tool_access,
            Some(run_id),
            emit,
        );
    }
    spawn_native_session(
        kind,
        worktree,
        prompt,
        model,
        thinking,
        speed,
        cli_args,
        tool_access,
        secrets,
        Some(run_id),
        emit,
    )
}
