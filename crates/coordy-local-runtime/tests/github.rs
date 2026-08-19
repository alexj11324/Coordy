use coordy_local_runtime::{parse_github_remote, parse_pr_list};
use coordy_protocol::GithubPullRequestItem;

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
    let fetched = coordy_local_runtime::collect(Some("/workspace"));
    assert!(fetched.cli_available, "{}", fetched.error);
    assert!(fetched.authenticated, "{}", fetched.error);
    assert!(fetched.error.is_empty(), "{}", fetched.error);
    assert!(
        fetched
            .items
            .iter()
            .any(|item| item.number == 3 && item.checks_total > 0),
        "expected PR #3 with CI checks, got {:?}",
        fetched
            .items
            .iter()
            .map(|item| (item.number, item.checks_total, item.checks_rollup.clone()))
            .collect::<Vec<_>>()
    );
}
