use std::time::Duration;

use coordy_control_plane::{router, ClerkConfig, ClerkVerifier, ControlPlane, Store};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct JwtFixtures {
    jwks: Value,
    admin: String,
    member: String,
    outsider: String,
    pending: String,
    wrong_aud: String,
    expired: String,
}

struct ServerFixture {
    base: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ServerFixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn fixtures() -> JwtFixtures {
    serde_json::from_str(include_str!("fixtures/jwt.json")).unwrap()
}

fn clerk(fixtures: &JwtFixtures) -> ClerkVerifier {
    ClerkVerifier::with_static_jwks(
        ClerkConfig {
            issuer: "https://test.clerk.accounts.dev".into(),
            audience: "coordy-control-plane".into(),
            authorized_parties: vec!["http://localhost:3000".into()],
            jwks_url: "https://test.clerk.accounts.dev/.well-known/jwks.json".into(),
            clock_skew_seconds: 5,
            jwks_cache_ttl: Duration::from_secs(300),
        },
        &fixtures.jwks.to_string(),
    )
    .unwrap()
}

async fn serve(path: &std::path::Path, fixtures: &JwtFixtures) -> ServerFixture {
    let state = ControlPlane::from_parts(clerk(fixtures), Store::open(path).unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router(state)).await.unwrap();
    });
    ServerFixture {
        base: format!("http://{address}"),
        task,
    }
}

async fn get(
    client: &Client,
    server: &ServerFixture,
    path: &str,
    token: Option<&str>,
) -> reqwest::Response {
    let mut request = client.get(format!("{}{path}", server.base));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request.send().await.unwrap()
}

async fn post(
    client: &Client,
    server: &ServerFixture,
    path: &str,
    token: &str,
    body: Value,
) -> reqwest::Response {
    client
        .post(format!("{}{path}", server.base))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn authenticated_tenant_durable_concurrent_http_flow() {
    let fixtures = fixtures();
    let database = std::env::temp_dir().join(format!(
        "coordy-control-plane-{}.sqlite3",
        uuid::Uuid::new_v4()
    ));
    let client = Client::new();
    let mut server = serve(&database, &fixtures).await;

    assert_eq!(
        get(&client, &server, "/health", None).await.status(),
        StatusCode::OK
    );
    let mut tampered = fixtures.admin.clone();
    tampered.pop();
    tampered.push('A');
    for token in [
        None,
        Some("garbage"),
        Some(tampered.as_str()),
        Some(fixtures.pending.as_str()),
        Some(fixtures.wrong_aud.as_str()),
        Some(fixtures.expired.as_str()),
    ] {
        assert_eq!(
            get(&client, &server, "/v1/workspaces", token)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }

    let provision = post(
        &client,
        &server,
        "/v1/workspaces/provision",
        &fixtures.admin,
        json!({"name":"Alpha"}),
    )
    .await;
    assert_eq!(provision.status(), StatusCode::OK);
    let provision: Value = provision.json().await.unwrap();
    let workspace_id = provision["workspace"]["id"].as_str().unwrap().to_string();
    let database_check = rusqlite::Connection::open(&database).unwrap();
    let journal_mode: String = database_check
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    let schema_version: i64 = database_check
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode, "wal");
    assert_eq!(schema_version, 1);
    drop(database_check);

    let member_list: Value = get(&client, &server, "/v1/workspaces", Some(&fixtures.member))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(member_list["items"][0]["id"], workspace_id);
    let outsider_list: Value = get(&client, &server, "/v1/workspaces", Some(&fixtures.outsider))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(outsider_list["items"].as_array().unwrap().len(), 0);

    let member_admin = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.member,
        json!({
            "command":{"type":"UpdateWorkspace","workspace_id":workspace_id,"name":"Nope"},
            "idempotency_key":"member-admin"
        }),
    )
    .await;
    assert_eq!(member_admin.status(), StatusCode::FORBIDDEN);
    let outsider_mutation = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.outsider,
        json!({
            "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"cross-tenant","description":""},
            "idempotency_key":"cross-tenant"
        }),
    )
    .await;
    assert_eq!(outsider_mutation.status(), StatusCode::NOT_FOUND);

    let create_body = json!({
        "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"one","description":""},
        "idempotency_key":"create-one"
    });
    let created: Value = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.member,
        create_body.clone(),
    )
    .await
    .json()
    .await
    .unwrap();
    let created_version = created["version"].as_i64().unwrap();
    let duplicate: Value = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.member,
        create_body,
    )
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(duplicate["version"], created_version);
    assert_eq!(duplicate["data"]["duplicate"], true);
    let idempotency_conflict = post(&client, &server, "/v1/submit", &fixtures.member, json!({
        "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"different","description":""},
        "idempotency_key":"create-one"
    })).await;
    assert_eq!(idempotency_conflict.status(), StatusCode::CONFLICT);
    let stale = post(&client, &server, "/v1/submit", &fixtures.member, json!({
        "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"stale","description":""},
        "idempotency_key":"stale","expected_version":created_version-1
    })).await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let a = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.member,
        json!({
            "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"parallel-a","description":""},"idempotency_key":"parallel-a"
        }),
    );
    let b = post(
        &client,
        &server,
        "/v1/submit",
        &fixtures.admin,
        json!({
            "command":{"type":"CreateTask","workspace_id":workspace_id,"title":"parallel-b","description":""},"idempotency_key":"parallel-b"
        }),
    );
    let (a, b) = tokio::join!(a, b);
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);

    for command in [
        json!({"type":"AppendMemory","workspace_id":workspace_id,"visibility":"principal","body":"secret","owner_actor_id":"principal_fake"}),
        json!({"type":"BindRepository","workspace_id":workspace_id,"path":"/Users/alex/private"}),
        json!({"type":"SetIntegration","workspace_id":workspace_id,"kind":"provider","enabled":true,"config":"api_key=secret"}),
        json!({"type":"AddAttachment","task_id":"task_fake","name":"secret","path":"/etc/passwd"}),
    ] {
        let rejected = post(
            &client,
            &server,
            "/v1/submit",
            &fixtures.admin,
            json!({"command":command,"idempotency_key":uuid::Uuid::new_v4().to_string()}),
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    let upload: Value = post(
        &client,
        &server,
        "/v1/attachments",
        &fixtures.member,
        json!({
            "name":"note.txt","content_type":"text/plain","content_base64":"aGVsbG8=","shared":true
        }),
    )
    .await
    .json()
    .await
    .unwrap();
    let attachment_id = upload["attachment"]["id"].as_str().unwrap();
    assert_eq!(
        get(
            &client,
            &server,
            &format!("/v1/attachments/{attachment_id}"),
            Some(&fixtures.member)
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        get(
            &client,
            &server,
            &format!("/v1/attachments/{attachment_id}"),
            Some(&fixtures.outsider)
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );

    server.task.abort();
    server = serve(&database, &fixtures).await;
    let board: Value = post(
        &client,
        &server,
        "/v1/view",
        &fixtures.member,
        json!({"query":{"type":"Board","workspace_id":workspace_id}}),
    )
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(board["data"]["tasks"].as_array().unwrap().len(), 3);
    let watch: Value = get(
        &client,
        &server,
        "/v1/watch?cursor=0",
        Some(&fixtures.member),
    )
    .await
    .json()
    .await
    .unwrap();
    assert!(!watch["data"]["effects"].as_array().unwrap().is_empty());
    let audit: Value = get(&client, &server, "/v1/audit", Some(&fixtures.admin))
        .await
        .json()
        .await
        .unwrap();
    assert!(audit["audit"].as_array().unwrap().len() >= 5);
    let audit_text = audit.to_string();
    assert!(!audit_text.contains("api_key=secret"));
    assert!(!audit_text.contains(&fixtures.admin));

    server.task.abort();
    let _ = std::fs::remove_file(&database);
    let _ = std::fs::remove_file(database.with_extension("sqlite3-wal"));
    let _ = std::fs::remove_file(database.with_extension("sqlite3-shm"));
}
