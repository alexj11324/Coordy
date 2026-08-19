use coordy_local_runtime::{parse_github_remote, parse_pr_list, Runtime};
use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, Command, GithubPullRequestItem, Query, View,
};

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn daemon_cmd(command: Command) -> AuthenticatedCommand {
    AuthenticatedCommand {
        actor: Actor::Daemon,
        command,
    }
}

#[test]
fn parse_ssh_and_https_remotes() {
    assert_eq!(
        parse_github_remote("git@github.com:acme/app.git"),
        Some("acme/app".into())
    );
    assert_eq!(
        parse_github_remote("https://github.com/acme/app.git\n"),
        Some("acme/app".into())
    );
}

#[test]
fn parse_gh_pr_list_rollup_array() {
    let raw = r#"[{
        "number": 2,
        "title": "Set up Cursor Cloud",
        "url": "https://github.com/alexj11324/Coordy/pull/2",
        "state": "MERGED",
        "isDraft": false,
        "headRefName": "cursor/setup-dev-environment-4733",
        "author": {"login": "alexj11324"},
        "body": "Closes COOR-1",
        "additions": 37,
        "deletions": 0,
        "changedFiles": 1,
        "mergeable": "UNKNOWN",
        "mergeStateStatus": "UNKNOWN",
        "headRepositoryOwner": {"login": "alexj11324"},
        "statusCheckRollup": [
            {
                "__typename": "CheckRun",
                "name": "python (3.11)",
                "status": "COMPLETED",
                "conclusion": "SUCCESS"
            },
            {
                "__typename": "CheckRun",
                "name": "rust",
                "status": "IN_PROGRESS",
                "conclusion": ""
            },
            {
                "__typename": "CheckRun",
                "name": "desktop",
                "status": "COMPLETED",
                "conclusion": "FAILURE"
            },
            {
                "__typename": "StatusContext",
                "context": "CodeRabbit",
                "state": "SUCCESS"
            }
        ]
    }]"#;
    let items = parse_pr_list(raw.as_bytes(), "alexj11324/Coordy").unwrap();
    assert_eq!(items.len(), 1);
    let pr: &GithubPullRequestItem = &items[0];
    assert_eq!(pr.number, 2);
    assert_eq!(pr.state, "merged");
    assert_eq!(pr.author, "alexj11324");
    assert_eq!(pr.repo, "alexj11324/Coordy");
    assert_eq!(pr.checks_rollup, "failure");
    assert_eq!(pr.checks_failed, 1);
    assert_eq!(pr.checks_running, 1);
    assert_eq!(pr.checks_passed, 2);
    assert_eq!(pr.failed_check_names, vec!["desktop"]);
    assert!(pr.snapshot_available);
}

#[test]
fn parse_gh_pr_list_treats_skipped_as_absent() {
    let raw = r#"[{
        "number": 8,
        "title": "draft work",
        "url": "https://github.com/acme/app/pull/8",
        "state": "OPEN",
        "isDraft": true,
        "headRefName": "coor-3-wip",
        "author": {"login": "dev"},
        "body": "",
        "additions": 1,
        "deletions": 0,
        "changedFiles": 1,
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
        "statusCheckRollup": [
            {"name": "lint", "status": "COMPLETED", "conclusion": "SKIPPED"},
            {"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}
        ]
    }]"#;
    let items = parse_pr_list(raw.as_bytes(), "acme/app").unwrap();
    assert_eq!(items[0].state, "draft");
    assert_eq!(items[0].checks_rollup, "success");
    assert_eq!(items[0].checks_total, 1);
    assert_eq!(items[0].merge_state, "clean");
}

#[test]
fn collect_without_repo_does_not_pretend_to_list_pull_requests() {
    let fetched = coordy_local_runtime::collect(None);
    assert!(fetched.items.is_empty());
    if fetched.authenticated {
        assert!(
            fetched.error.contains("代码仓库"),
            "unbound workspace must not look like an empty successful listing: {:?}",
            fetched.error
        );
    }
}

#[test]
fn collect_coordy_repo_through_gh_cli() {
    let repo = repo_root();
    let fetched = coordy_local_runtime::collect(Some(repo.to_str().unwrap()));
    if !fetched.cli_available || !fetched.authenticated {
        eprintln!("skip live gh collect: {}", fetched.error);
        return;
    }
    if !fetched.error.is_empty() {
        eprintln!("skip live gh listing: {}", fetched.error);
        return;
    }
    if fetched.items.is_empty() {
        eprintln!(
            "skip live gh collect: no pull requests in {}",
            repo.display()
        );
        return;
    }
    assert!(fetched
        .items
        .iter()
        .any(|item| item.snapshot_available && item.number > 0));
    if let Some(with_checks) = fetched.items.iter().find(|item| item.checks_total > 0) {
        assert!(
            matches!(
                with_checks.checks_rollup.as_str(),
                "success" | "failure" | "pending"
            ),
            "unexpected rollup {} for PR #{}",
            with_checks.checks_rollup,
            with_checks.number
        );
    }
}

#[test]
fn refresh_github_via_daemon_fills_manual_link_from_gh() {
    let repo = repo_root();
    let probe = coordy_local_runtime::collect(Some(repo.to_str().unwrap()));
    if !probe.authenticated || !probe.error.is_empty() {
        eprintln!("skip live daemon refresh: {}", probe.error);
        return;
    }
    let Some(sample) = probe
        .items
        .iter()
        .find(|item| item.snapshot_available && item.number > 0)
        .cloned()
    else {
        eprintln!("skip live daemon refresh: no pull requests");
        return;
    };

    let dir = std::env::temp_dir().join(format!("coordy-gh-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let runtime = Runtime::open(&dir, &dir.join("unused.sock"), "tok".into()).unwrap();
    let workspace_id = runtime
        .submit_and_persist(daemon_cmd(Command::CreateWorkspace {
            name: "github-cli".into(),
        }))
        .unwrap()
        .ids["workspace_id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime
        .submit_and_persist(daemon_cmd(Command::BindRepository {
            workspace_id: workspace_id.clone(),
            path: repo.to_string_lossy().into_owned(),
        }))
        .unwrap();
    let task_id = runtime
        .submit_and_persist(daemon_cmd(Command::CreateTask {
            workspace_id: workspace_id.clone(),
            title: "observe ci".into(),
            description: String::new(),
        }))
        .unwrap()
        .ids["task_id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime
        .submit_and_persist(daemon_cmd(Command::LinkPullRequest {
            task_id: task_id.clone(),
            number: sample.number,
            url: sample.url.clone(),
        }))
        .unwrap();
    runtime
        .submit_and_persist(daemon_cmd(Command::RefreshGithub {
            workspace_id: workspace_id.clone(),
        }))
        .unwrap();

    let board = runtime
        .kernel
        .view_sync(AuthorizedQuery {
            actor: Actor::Daemon,
            query: Query::Board { workspace_id },
        })
        .unwrap();
    let View::Board { tasks } = board else {
        panic!("board");
    };
    let task = tasks.iter().find(|row| row.id == task_id).unwrap();
    assert_eq!(task.pull_requests.len(), 1);
    let pr = &task.pull_requests[0];
    assert_eq!(pr.number, sample.number);
    assert_eq!(pr.title, sample.title);
    assert!(pr.snapshot_available);
    assert!(!pr.snapshot_stale);
    assert_eq!(pr.checks_total, sample.checks_total);
    assert_eq!(pr.checks_rollup, sample.checks_rollup);
}
