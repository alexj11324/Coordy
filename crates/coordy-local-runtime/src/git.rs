use std::path::PathBuf;
use std::process::Command;

use coordy_harness::{canonical_harness_id, detect_on_path, spawn_command};
use coordy_kernel::{read_jsonl, Ports};
use coordy_protocol::{CoordyError, HarnessEvent};

#[derive(Default)]
pub struct GitPorts;

impl Ports for GitPorts {
    fn create_worktree(&self, repo: &str, task_id: &str) -> Result<String, CoordyError> {
        let dest = PathBuf::from(repo)
            .join(".coordy")
            .join("worktrees")
            .join(task_id);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| CoordyError::unavailable(format!("worktree dir: {e}")))?;
        }
        let branch = format!("coordy/{task_id}");
        let status = Command::new("git")
            .current_dir(repo)
            .args([
                "worktree",
                "add",
                "-B",
                &branch,
                dest.to_str().unwrap_or_default(),
            ])
            .status()
            .map_err(|e| CoordyError::unavailable(format!("git worktree: {e}")))?;
        if !status.success() {
            return Err(CoordyError::unavailable("git worktree add failed"));
        }
        Ok(dest.display().to_string())
    }

    fn apply_patch(&self, worktree: &str, patch: &str) -> Result<(), CoordyError> {
        let patch_path = PathBuf::from(worktree).join(".coordy-apply.patch");
        std::fs::write(&patch_path, patch)
            .map_err(|e| CoordyError::unavailable(format!("write patch: {e}")))?;
        let check = Command::new("git")
            .current_dir(worktree)
            .args(["apply", "--check", patch_path.to_str().unwrap_or_default()])
            .status()
            .map_err(|e| CoordyError::unavailable(format!("git apply check: {e}")))?;
        if !check.success() {
            return Err(CoordyError::invalid("patch does not apply"));
        }
        let apply = Command::new("git")
            .current_dir(worktree)
            .args(["apply", patch_path.to_str().unwrap_or_default()])
            .status()
            .map_err(|e| CoordyError::unavailable(format!("git apply: {e}")))?;
        if !apply.success() {
            return Err(CoordyError::invalid("git apply failed"));
        }
        Ok(())
    }

    fn read_jsonl(&self, path: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
        read_jsonl(path)
    }

    fn spawn_harness(
        &self,
        kind: &str,
        worktree: &str,
        prompt: &str,
        _run_id: &str,
        _model: &str,
    ) -> Result<(), CoordyError> {
        let kind = canonical_harness_id(kind);
        if detect_on_path()
            .iter()
            .all(|d| canonical_harness_id(&d.kind) != kind)
        {
            return Err(CoordyError::unavailable(format!(
                "{kind} is not installed; use JSONL replay or install the harness"
            )));
        }
        let mut cmd = spawn_command(kind, worktree, prompt, _model)?;
        let _child = cmd
            .spawn()
            .map_err(|e| CoordyError::unavailable(format!("spawn {kind}: {e}")))?;
        Ok(())
    }

    fn cancel_harness(&self, _run_id: &str) -> Result<(), CoordyError> {
        Ok(())
    }
}
