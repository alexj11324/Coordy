use coordy_protocol::{CoordyError, HarnessEvent};

pub fn new(prefix: &str) -> String {
    format!("{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub trait Ports: Send + Sync {
    fn create_worktree(&self, repo: &str, task_id: &str) -> Result<String, CoordyError>;
    fn apply_patch(&self, worktree: &str, patch: &str) -> Result<(), CoordyError>;
    fn read_jsonl(&self, path: &str) -> Result<Vec<HarnessEvent>, CoordyError>;
    fn spawn_harness(
        &self,
        kind: &str,
        worktree: &str,
        prompt: &str,
        run_id: &str,
        model: &str,
    ) -> Result<(), CoordyError>;

    fn cancel_harness(&self, run_id: &str) -> Result<(), CoordyError>;
}

#[derive(Default)]
pub struct NoopPorts;

impl Ports for NoopPorts {
    fn create_worktree(&self, _repo: &str, task_id: &str) -> Result<String, CoordyError> {
        Ok(format!("/tmp/coordy-worktree-{task_id}"))
    }

    fn apply_patch(&self, _worktree: &str, _patch: &str) -> Result<(), CoordyError> {
        Ok(())
    }

    fn read_jsonl(&self, path: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
        crate::jsonl::read_jsonl(path)
    }

    fn spawn_harness(
        &self,
        kind: &str,
        _worktree: &str,
        _prompt: &str,
        _run_id: &str,
        _model: &str,
    ) -> Result<(), CoordyError> {
        if kind == "codex" || kind == "claude_code" || kind == "opencode" || kind == "acp" {
            return Err(CoordyError::unavailable(format!(
                "harness {kind} is not available in this test port"
            )));
        }
        Ok(())
    }

    fn cancel_harness(&self, _run_id: &str) -> Result<(), CoordyError> {
        Ok(())
    }
}

#[derive(Default)]
pub struct RecordingPorts {
    pub worktrees: std::sync::Mutex<Vec<String>>,
    pub patches: std::sync::Mutex<Vec<String>>,
    pub spawns: std::sync::Mutex<Vec<(String, String, String, String, String)>>,
    pub cancelled: std::sync::Mutex<Vec<String>>,
}

impl Ports for RecordingPorts {
    fn create_worktree(&self, _repo: &str, task_id: &str) -> Result<String, CoordyError> {
        let path = format!("/tmp/coordy-worktree-{task_id}");
        self.worktrees.lock().unwrap().push(path.clone());
        Ok(path)
    }

    fn apply_patch(&self, _worktree: &str, patch: &str) -> Result<(), CoordyError> {
        self.patches.lock().unwrap().push(patch.to_string());
        Ok(())
    }

    fn read_jsonl(&self, path: &str) -> Result<Vec<HarnessEvent>, CoordyError> {
        crate::jsonl::read_jsonl(path)
    }

    fn spawn_harness(
        &self,
        kind: &str,
        worktree: &str,
        prompt: &str,
        run_id: &str,
        model: &str,
    ) -> Result<(), CoordyError> {
        self.spawns.lock().unwrap().push((
            kind.to_string(),
            worktree.to_string(),
            prompt.to_string(),
            run_id.to_string(),
            model.to_string(),
        ));
        Ok(())
    }

    fn cancel_harness(&self, run_id: &str) -> Result<(), CoordyError> {
        self.cancelled.lock().unwrap().push(run_id.to_string());
        Ok(())
    }
}
