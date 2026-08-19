//! Read GitHub pull request + CI snapshots through the local `gh` CLI.

use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use coordy_harness::which_bin;
use coordy_protocol::{Command as KernelCommand, GithubPullRequestItem};
use serde::Deserialize;
use serde_json::Value;

const PR_LIST_LIMIT: &str = "40";
const GH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GithubFetch {
    pub cli_available: bool,
    pub authenticated: bool,
    pub account: String,
    pub error: String,
    pub items: Vec<GithubPullRequestItem>,
}

impl GithubFetch {
    pub fn into_command(self, workspace_id: String) -> KernelCommand {
        KernelCommand::SyncGithubPullRequests(Box::new(coordy_protocol::GithubSync {
            workspace_id,
            cli_available: self.cli_available,
            authenticated: self.authenticated,
            account: self.account,
            error: self.error,
            fetched_at: chrono::Utc::now().to_rfc3339(),
            items: self.items,
        }))
    }
}

pub fn collect(repo: Option<&str>) -> GithubFetch {
    let Some(gh) = which_bin("gh") else {
        return GithubFetch {
            error: "未找到 GitHub CLI（gh）。安装后运行 gh auth login。".into(),
            ..GithubFetch::default()
        };
    };
    let (authenticated, account, auth_error) = probe_auth(&gh);
    if !authenticated {
        return GithubFetch {
            cli_available: true,
            authenticated: false,
            account,
            error: if auth_error.is_empty() {
                "GitHub CLI 未登录。在终端运行 gh auth login。".into()
            } else {
                auth_error
            },
            items: Vec::new(),
        };
    }
    let Some(repo_path) = repo.filter(|path| !path.is_empty()) else {
        return GithubFetch {
            cli_available: true,
            authenticated: true,
            account,
            error: "尚未绑定代码仓库。".into(),
            items: Vec::new(),
        };
    };
    match list_pull_requests(&gh, Path::new(repo_path)) {
        Ok(items) => GithubFetch {
            cli_available: true,
            authenticated: true,
            account,
            error: String::new(),
            items,
        },
        Err(error) => GithubFetch {
            cli_available: true,
            authenticated: true,
            account,
            error,
            items: Vec::new(),
        },
    }
}

fn probe_auth(gh: &Path) -> (bool, String, String) {
    match run_gh(gh, None, &["auth", "status"]) {
        Ok(output) if output.status.success() => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            (true, parse_auth_account(&text), String::new())
        }
        Ok(output) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let message = text.trim();
            (
                false,
                parse_auth_account(&text),
                if message.is_empty() {
                    "GitHub CLI 未登录。在终端运行 gh auth login。".into()
                } else {
                    message.chars().take(240).collect()
                },
            )
        }
        Err(error) => (false, String::new(), error),
    }
}

fn parse_auth_account(text: &str) -> String {
    for token in ["account ", "Logged in to github.com as "] {
        if let Some(rest) = text.split(token).nth(1) {
            let name = rest
                .split(|c: char| c.is_whitespace() || c == '(' || c == '/')
                .next()
                .unwrap_or("")
                .trim();
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    String::new()
}

fn list_pull_requests(gh: &Path, repo: &Path) -> Result<Vec<GithubPullRequestItem>, String> {
    let repo_name = repo_name_with_owner(gh, repo).unwrap_or_default();
    let output = run_gh(
        gh,
        Some(repo),
        &[
            "pr",
            "list",
            "--state",
            "all",
            "--limit",
            PR_LIST_LIMIT,
            "--json",
            "number,title,url,state,isDraft,headRefName,author,body,additions,deletions,changedFiles,mergeable,mergeStateStatus,statusCheckRollup,headRepositoryOwner",
        ],
    )?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.trim().is_empty() {
            "gh pr list 失败".into()
        } else {
            err.trim().chars().take(240).collect()
        });
    }
    parse_pr_list(&output.stdout, &repo_name)
}

fn repo_name_with_owner(gh: &Path, repo: &Path) -> Option<String> {
    if let Ok(output) = run_gh(gh, Some(repo), &["repo", "view", "--json", "nameWithOwner"]) {
        if output.status.success() {
            if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
                if let Some(name) = value.get("nameWithOwner").and_then(Value::as_str) {
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }
    let output = Command::new("git")
        .current_dir(repo)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_github_remote(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_github_remote(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches(".git");
    for prefix in [
        "git@github.com:",
        "ssh://git@github.com/",
        "https://github.com/",
        "http://github.com/",
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let rest = rest.trim_start_matches('/');
            let parts: Vec<&str> = rest.split('/').filter(|part| !part.is_empty()).collect();
            if parts.len() >= 2 {
                return Some(format!("{}/{}", parts[0], parts[1]));
            }
        }
    }
    None
}

#[derive(Deserialize)]
struct GhAuthor {
    #[serde(default)]
    login: String,
}

#[derive(Deserialize)]
struct GhOwner {
    #[serde(default)]
    login: String,
}

#[derive(Deserialize)]
struct GhPullRequest {
    number: u32,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    #[serde(rename = "isDraft")]
    is_draft: bool,
    #[serde(default)]
    #[serde(rename = "headRefName")]
    head_ref_name: String,
    #[serde(default)]
    author: Option<GhAuthor>,
    #[serde(default)]
    body: String,
    #[serde(default)]
    additions: u32,
    #[serde(default)]
    deletions: u32,
    #[serde(default)]
    #[serde(rename = "changedFiles")]
    changed_files: u32,
    #[serde(default)]
    mergeable: String,
    #[serde(default)]
    #[serde(rename = "mergeStateStatus")]
    merge_state_status: String,
    #[serde(default)]
    #[serde(rename = "statusCheckRollup")]
    status_check_rollup: Value,
    #[serde(default)]
    #[serde(rename = "headRepositoryOwner")]
    head_repository_owner: Option<GhOwner>,
}

pub fn parse_pr_list(
    raw: &[u8],
    fallback_repo: &str,
) -> Result<Vec<GithubPullRequestItem>, String> {
    let rows: Vec<GhPullRequest> =
        serde_json::from_slice(raw).map_err(|err| format!("gh pr list JSON: {err}"))?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let checks = summarize_checks(&row.status_check_rollup);
            let owner = row
                .head_repository_owner
                .as_ref()
                .map(|owner| owner.login.as_str())
                .filter(|login| !login.is_empty());
            let repo = match (owner, fallback_repo.split_once('/')) {
                (Some(login), Some((_, name))) => format!("{login}/{name}"),
                _ => fallback_repo.to_string(),
            };
            GithubPullRequestItem {
                number: row.number,
                url: row.url,
                title: row.title,
                state: normalize_state(&row.state, row.is_draft),
                repo,
                branch: row.head_ref_name,
                author: row.author.map(|author| author.login).unwrap_or_default(),
                body: row.body,
                additions: row.additions,
                deletions: row.deletions,
                changed_files: row.changed_files,
                mergeable: row.mergeable.to_ascii_lowercase(),
                merge_state: row.merge_state_status.to_ascii_lowercase(),
                checks_rollup: checks.rollup,
                checks_total: checks.total,
                checks_passed: checks.passed,
                checks_failed: checks.failed,
                checks_running: checks.running,
                failed_check_names: checks.failed_names,
                snapshot_available: true,
            }
        })
        .collect())
}

struct CheckSummary {
    rollup: String,
    total: u32,
    passed: u32,
    failed: u32,
    running: u32,
    failed_names: Vec<String>,
}

fn summarize_checks(value: &Value) -> CheckSummary {
    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut running = 0u32;
    let mut failed_names = Vec::new();
    let nodes = match value {
        Value::Array(items) => items.clone(),
        Value::Object(map) => map
            .get("contexts")
            .and_then(|contexts| contexts.get("nodes"))
            .and_then(Value::as_array)
            .cloned()
            .or_else(|| map.get("nodes").and_then(Value::as_array).cloned())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    for node in &nodes {
        let name = node
            .get("name")
            .or_else(|| node.get("context"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let status = node
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        let conclusion = node
            .get("conclusion")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        let state = node
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        if matches!(conclusion.as_str(), "SKIPPED" | "NEUTRAL") {
            continue;
        }
        let is_running = matches!(
            status.as_str(),
            "IN_PROGRESS" | "QUEUED" | "PENDING" | "WAITING" | "REQUESTED" | "WAITING_TO_START"
        ) || matches!(state.as_str(), "PENDING" | "EXPECTED");
        let is_failed = matches!(
            conclusion.as_str(),
            "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" | "STALE"
        ) || matches!(state.as_str(), "FAILURE" | "ERROR");
        let is_passed = conclusion == "SUCCESS" || state == "SUCCESS";
        if is_failed {
            failed += 1;
            if !name.is_empty() {
                failed_names.push(name);
            }
        } else if is_running {
            running += 1;
        } else if is_passed {
            passed += 1;
        }
    }
    let total = passed + failed + running;
    let rollup = if failed > 0 {
        "failure".to_string()
    } else if running > 0 {
        "pending".to_string()
    } else if passed > 0 {
        "success".to_string()
    } else {
        String::new()
    };
    CheckSummary {
        rollup,
        total,
        passed,
        failed,
        running,
        failed_names,
    }
}

fn normalize_state(state: &str, is_draft: bool) -> String {
    let lower = state.to_ascii_lowercase();
    if is_draft && lower == "open" {
        "draft".into()
    } else {
        lower
    }
}

fn run_gh(gh: &Path, cwd: Option<&Path>, args: &[&str]) -> Result<std::process::Output, String> {
    run_gh_with_timeout(gh, cwd, args, GH_TIMEOUT)
}

fn run_gh_with_timeout(
    gh: &Path,
    cwd: Option<&Path>,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(gh);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.env("GH_PROMPT_DISABLED", "1");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    isolate_process_tree(&mut cmd);
    let mut child = cmd.spawn().map_err(|err| format!("spawn gh: {err}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "spawn gh: stdout pipe unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "spawn gh: stderr pipe unavailable".to_string())?;
    let (stdout_tx, stdout_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stdout = stdout;
        let _ = stdout_tx.send(stdout.read_to_end(&mut bytes).map(|_| bytes));
    });
    let (stderr_tx, stderr_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stderr = stderr;
        let _ = stderr_tx.send(stderr.read_to_end(&mut bytes).map(|_| bytes));
    });
    let started = Instant::now();
    let mut status = None;
    let mut stdout = None;
    let mut stderr = None;
    loop {
        if status.is_none() {
            match child.try_wait() {
                Ok(next) => status = next,
                Err(err) => {
                    terminate_process_tree(&mut child);
                    return Err(format!("wait gh: {err}"));
                }
            }
        }
        if stdout.is_none() {
            match stdout_rx.try_recv() {
                Ok(Ok(bytes)) => stdout = Some(bytes),
                Ok(Err(err)) => {
                    terminate_process_tree(&mut child);
                    return Err(format!("read gh stdout: {err}"));
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    terminate_process_tree(&mut child);
                    return Err("read gh stdout: reader stopped".into());
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if stderr.is_none() {
            match stderr_rx.try_recv() {
                Ok(Ok(bytes)) => stderr = Some(bytes),
                Ok(Err(err)) => {
                    terminate_process_tree(&mut child);
                    return Err(format!("read gh stderr: {err}"));
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    terminate_process_tree(&mut child);
                    return Err("read gh stderr: reader stopped".into());
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if status.is_some() && stdout.is_some() && stderr.is_some() {
            return Ok(std::process::Output {
                status: status.expect("checked"),
                stdout: stdout.take().expect("checked"),
                stderr: stderr.take().expect("checked"),
            });
        }
        if started.elapsed() >= timeout {
            terminate_process_tree(&mut child);
            return Err(format!("gh timed out after {}s", timeout.as_secs_f64()));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(unix)]
fn isolate_process_tree(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;

    cmd.process_group(0);
}

#[cfg(not(unix))]
fn isolate_process_tree(_cmd: &mut Command) {}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        // SAFETY: the child was placed in a process group whose id is its pid.
        // A negative pid targets only that group, never the caller's group.
        unsafe {
            libc::kill(process_group, libc::SIGKILL);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn test_script(name: &str, body: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coordy-gh-process-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gh");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[test]
    fn gh_processes_are_bounded_and_normal_output_is_preserved() {
        let hanging = test_script("timeout", "while :; do :; done");
        let started = Instant::now();
        let error =
            run_gh_with_timeout(&hanging, None, &[], Duration::from_millis(100)).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));

        let descendant = test_script("descendant", "sleep 30 & exit 0");
        let started = Instant::now();
        let error =
            run_gh_with_timeout(&descendant, None, &[], Duration::from_millis(100)).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));

        let normal = test_script("normal", "printf '[]'");
        let output = run_gh_with_timeout(&normal, None, &[], Duration::from_secs(1)).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"[]");

        let _ = std::fs::remove_dir_all(hanging.parent().unwrap());
        let _ = std::fs::remove_dir_all(descendant.parent().unwrap());
        let _ = std::fs::remove_dir_all(normal.parent().unwrap());
    }
}
