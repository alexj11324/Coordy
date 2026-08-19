use std::fs;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| "help".into());
    match cmd.as_str() {
        "codegen-ts" => codegen_ts()?,
        "verify-protocol" => verify_protocol()?,
        _ => eprintln!("xtask <codegen-ts|verify-protocol>"),
    }
    Ok(())
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn enum_variants(src: &str, name: &str) -> Vec<String> {
    let marker = format!("pub enum {name}");
    let start = src.find(&marker).expect("enum");
    let rest = &src[start..];
    let body_start = rest.find('{').unwrap();
    let mut depth = 0;
    let mut end = 0;
    for (i, c) in rest.char_indices() {
        if i < body_start {
            continue;
        }
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }
    let body = &rest[body_start + 1..end];
    let mut names = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with("//")
            || line.starts_with("pub ")
        {
            continue;
        }
        let ident = line
            .split(|c: char| c == '{' || c == '(' || c == ',' || c.is_whitespace())
            .next()
            .unwrap_or("");
        if ident.starts_with(char::is_uppercase) {
            names.push(ident.to_string());
        }
    }
    names
}

fn codegen_ts() -> anyhow::Result<()> {
    verify_protocol()?;
    println!(
        "protocol-ts mirror checked at {}",
        workspace_root()
            .join("packages/protocol-ts/src/index.ts")
            .display()
    );
    Ok(())
}

fn verify_protocol() -> anyhow::Result<()> {
    let rust = fs::read_to_string(workspace_root().join("crates/coordy-protocol/src/lib.rs"))?;
    let ts = fs::read_to_string(workspace_root().join("packages/protocol-ts/src/index.ts"))?;
    for name in enum_variants(&rust, "Command") {
        let needle = format!("type: \"{name}\"");
        if !ts.contains(&needle) {
            anyhow::bail!("protocol-ts missing Command {name}");
        }
    }
    for name in enum_variants(&rust, "Query") {
        let needle = format!("type: \"{name}\"");
        if !ts.contains(&needle) {
            anyhow::bail!("protocol-ts missing Query {name}");
        }
    }
    Ok(())
}
