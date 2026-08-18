use std::os::unix::fs::PermissionsExt;

use coordy_local_runtime::SecretStore;

#[test]
fn secret_ref_stores_name_not_value() {
    let dir = std::env::temp_dir().join(format!("coordy-secret-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("COORDY_TEST_SECRET", "super-secret-value");
    let path = coordy_local_runtime::write_secret_ref(&dir, "COORDY_TEST_SECRET").unwrap();
    let stored = std::fs::read_to_string(&path).unwrap();
    assert_eq!(stored, "COORDY_TEST_SECRET");
    assert!(!stored.contains("super-secret-value"));
    assert_eq!(
        coordy_local_runtime::resolve_secret("COORDY_TEST_SECRET").as_deref(),
        Some("super-secret-value")
    );
}

#[test]
fn byok_key_is_0600_and_never_copied_into_meta() {
    let dir = std::env::temp_dir().join(format!("coordy-byok-{}", uuid_like()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let store = SecretStore::open(&dir);
    let status = store
        .set(
            "openai".into(),
            Some("sk-live-not-for-sqlite".into()),
            Some("https://api.example".into()),
            Some("codex acp".into()),
        )
        .unwrap();
    assert!(status.key_configured);
    assert_eq!(status.provider, "openai");
    assert_eq!(status.acp_command.as_deref(), Some("codex acp"));
    let key_path = dir.join("secrets/api_key");
    let meta = std::fs::read_to_string(dir.join("secrets/meta.json")).unwrap();
    assert_eq!(
        std::fs::read_to_string(&key_path).unwrap(),
        "sk-live-not-for-sqlite"
    );
    assert!(!meta.contains("sk-live-not-for-sqlite"));
    let mode = std::fs::metadata(&key_path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let env = store.env();
    assert_eq!(env.api_key.as_deref(), Some("sk-live-not-for-sqlite"));
    assert!(env
        .env_pairs()
        .iter()
        .any(|(k, v)| k == "OPENAI_API_KEY" && v == "sk-live-not-for-sqlite"));
}

fn uuid_like() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}
