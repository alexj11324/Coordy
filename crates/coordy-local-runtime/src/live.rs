use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::thread;

use coordy_harness::{
    parse_codex_jsonl_line, resolve_acp_command, spawn_acp_session, spawn_command, SecretEnv,
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

    fn spawn_harness(
        &self,
        kind: &str,
        worktree: &str,
        prompt: &str,
        run_id: &str,
    ) -> Result<(), CoordyError> {
        let tx = self.events.clone();
        let run_id = run_id.to_string();
        let kind = kind.to_string();
        let worktree = worktree.to_string();
        let prompt = prompt.to_string();
        let secrets = SecretStore::open(&self.data_dir).env();
        thread::spawn(move || {
            let emit = |event: HarnessEvent| {
                let _ = tx.send((run_id.clone(), event));
            };
            if let Err(err) = run_kind(&kind, &worktree, &prompt, &secrets, emit) {
                let _ = tx.send((
                    run_id,
                    HarnessEvent::Message {
                        role: "system".into(),
                        content: err.to_string(),
                    },
                ));
            }
        });
        Ok(())
    }
}

fn run_kind(
    kind: &str,
    worktree: &str,
    prompt: &str,
    secrets: &SecretEnv,
    mut emit: impl FnMut(HarnessEvent),
) -> Result<(), CoordyError> {
    match kind {
        "acp" => {
            let (bin, args) = resolve_acp_command(secrets.acp_command.as_deref())?;
            spawn_acp_session(&bin, &args, worktree, prompt, secrets, emit)
        }
        "codex" | "claude_code" | "opencode" => {
            let mut cmd = spawn_command(kind, worktree, prompt)?;
            for (key, value) in secrets.env_pairs() {
                cmd.env(key, value);
            }
            let output = cmd
                .output()
                .map_err(|e| CoordyError::unavailable(format!("run {kind}: {e}")))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut any = false;
            for line in stdout.lines() {
                if let Some(event) = parse_codex_jsonl_line(line) {
                    any = true;
                    emit(event);
                }
            }
            if !any {
                let text = if stdout.trim().is_empty() {
                    String::from_utf8_lossy(&output.stderr).into_owned()
                } else {
                    stdout.into_owned()
                };
                if !text.trim().is_empty() {
                    emit(HarnessEvent::Message {
                        role: "assistant".into(),
                        content: text,
                    });
                }
            }
            if !output.status.success() {
                return Err(CoordyError::unavailable(format!(
                    "{kind} exited {}",
                    output.status
                )));
            }
            Ok(())
        }
        _ => Err(CoordyError::invalid(format!("unknown harness {kind}"))),
    }
}
