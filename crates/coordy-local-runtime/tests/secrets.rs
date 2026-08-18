use coordy_local_runtime::{resolve_secret, write_secret_ref};

#[test]
fn secret_ref_stores_name_not_value() {
    let dir = std::env::temp_dir().join(format!("coordy-secret-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("COORDY_TEST_SECRET", "super-secret-value");
    let path = write_secret_ref(&dir, "COORDY_TEST_SECRET").unwrap();
    let stored = std::fs::read_to_string(&path).unwrap();
    assert_eq!(stored, "COORDY_TEST_SECRET");
    assert!(!stored.contains("super-secret-value"));
    assert_eq!(
        resolve_secret("COORDY_TEST_SECRET").as_deref(),
        Some("super-secret-value")
    );
}
