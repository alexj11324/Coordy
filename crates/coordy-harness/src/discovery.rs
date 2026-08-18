//! Discover ACP agents from PATH plus an optional registry.json snapshot.
//! Does not talk to the kernel. Network fetch lives in the local runtime.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use coordy_protocol::{CoordyError, DiscoveredAgentView};

pub fn suggested_acp_stub_command() -> Option<String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["coordy", "coordy.exe"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(format!("{} acp-stub", candidate.display()));
                }
            }
        }
    }
    which_bin("coordy").map(|p| format!("{} acp-stub", p.display()))
}

pub fn split_command(raw: &str) -> Result<(String, Vec<String>), CoordyError> {
    let mut parts = raw.split_whitespace();
    let bin = parts
        .next()
        .ok_or_else(|| CoordyError::invalid("empty ACP command"))?;
    Ok((bin.into(), parts.map(str::to_string).collect()))
}

const REGISTRY_ALIASES: &[(&str, &str, &[&str], &[&str])] = &[
    ("claude-acp", "Claude", &["claude", "claude-code"], &["acp"]),
    ("codex-acp", "Codex", &["codex"], &["acp"]),
    ("gemini", "Gemini CLI", &["gemini"], &["--acp"]),
    (
        "github-copilot-cli",
        "GitHub Copilot",
        &["copilot"],
        &["--acp"],
    ),
    ("opencode", "OpenCode", &["opencode"], &["acp"]),
    ("cursor", "Cursor", &["cursor-agent", "agent"], &["acp"]),
];

#[derive(Debug, Deserialize)]
struct RegistryFile {
    #[serde(default)]
    agents: Vec<RegistryAgent>,
}

#[derive(Debug, Deserialize)]
struct RegistryAgent {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    distribution: Distribution,
}

#[derive(Debug, Default, Deserialize)]
struct Distribution {
    #[serde(default)]
    npx: Option<NpxDist>,
    #[serde(default)]
    uvx: Option<UvxDist>,
    #[serde(default)]
    binary: Option<BTreeMap<String, BinaryDist>>,
}

#[derive(Debug, Deserialize)]
struct NpxDist {
    package: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct UvxDist {
    package: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct BinaryDist {
    #[serde(default)]
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
}

pub fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs_home() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join("bin"));
        let nvm = home.join(".nvm/versions/node");
        if nvm.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm) {
                let mut versions: Vec<PathBuf> =
                    entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
                versions.sort();
                if let Some(latest) = versions.pop() {
                    dirs.push(latest.join("bin"));
                }
            }
        }
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
    dirs
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub fn which_bin(name: &str) -> Option<PathBuf> {
    let mut search = Vec::new();
    if let Some(paths) = std::env::var_os("PATH") {
        search.extend(std::env::split_paths(&paths));
    }
    search.extend(extra_bin_dirs());
    for dir in search {
        for candidate in [dir.join(name), dir.join(format!("{name}.exe"))] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn discover(registry_json: Option<&str>) -> Vec<DiscoveredAgentView> {
    let mut by_id: BTreeMap<String, DiscoveredAgentView> = BTreeMap::new();

    if let Some(stub) = suggested_acp_stub_command() {
        by_id.insert(
            "coordy-stub".into(),
            DiscoveredAgentView {
                id: "coordy-stub".into(),
                name: "Coordy 演示".into(),
                installed: true,
                command: stub,
                source: "stub".into(),
                version: None,
            },
        );
    }

    for (id, name, bins, args) in REGISTRY_ALIASES {
        if let Some(bin) = bins.iter().find_map(|b| which_bin(b)) {
            let mut parts = vec![bin.display().to_string()];
            parts.extend(args.iter().map(|s| (*s).to_string()));
            by_id.insert(
                (*id).into(),
                DiscoveredAgentView {
                    id: (*id).into(),
                    name: (*name).into(),
                    installed: true,
                    command: parts.join(" "),
                    source: "path".into(),
                    version: None,
                },
            );
        }
    }

    if let Some(text) = registry_json {
        if let Ok(file) = serde_json::from_str::<RegistryFile>(text) {
            for agent in file.agents {
                let fallback = registry_launch(&agent);
                let entry = by_id
                    .entry(agent.id.clone())
                    .or_insert_with(|| DiscoveredAgentView {
                        id: agent.id.clone(),
                        name: if agent.name.is_empty() {
                            agent.id.clone()
                        } else {
                            agent.name.clone()
                        },
                        installed: false,
                        command: fallback.clone().unwrap_or_default(),
                        source: "registry".into(),
                        version: agent.version.clone(),
                    });
                if entry.name.is_empty() || entry.source == "path" || entry.source == "stub" {
                    if !agent.name.is_empty() {
                        entry.name = agent.name;
                    }
                }
                entry.version = agent.version.or(entry.version.clone());
                if !entry.installed {
                    if let Some(cmd) = fallback {
                        entry.command = cmd;
                        entry.source = "registry".into();
                    }
                }
            }
        }
    }

    by_id
        .into_values()
        .filter(|a| !a.command.trim().is_empty())
        .collect()
}

fn registry_launch(agent: &RegistryAgent) -> Option<String> {
    if let Some(npx) = &agent.distribution.npx {
        let mut parts = vec!["npx".into(), "-y".into(), npx.package.clone()];
        parts.extend(npx.args.iter().cloned());
        return Some(parts.join(" "));
    }
    if let Some(uvx) = &agent.distribution.uvx {
        let mut parts = vec!["uvx".into(), uvx.package.clone()];
        parts.extend(uvx.args.iter().cloned());
        return Some(parts.join(" "));
    }
    if let Some(binaries) = &agent.distribution.binary {
        let key = current_binary_key();
        if let Some(spec) = binaries.get(&key).or_else(|| binaries.values().next()) {
            let name = Path::new(&spec.cmd)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&spec.cmd);
            let stripped = name.trim_start_matches("./");
            if let Some(found) = which_bin(stripped) {
                let mut parts = vec![found.display().to_string()];
                parts.extend(spec.args.iter().cloned());
                return Some(parts.join(" "));
            }
            if !spec.cmd.is_empty() {
                let mut parts = vec![stripped.to_string()];
                parts.extend(spec.args.iter().cloned());
                return Some(parts.join(" "));
            }
        }
    }
    None
}

fn current_binary_key() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    match (os, arch) {
        ("macos", "aarch64") => "darwin-aarch64".into(),
        ("macos", "x86_64") => "darwin-x86_64".into(),
        ("linux", "aarch64") => "linux-aarch64".into(),
        ("linux", "x86_64") => "linux-x86_64".into(),
        ("windows", "x86_64") => "windows-x86_64".into(),
        _ => format!("{os}-{arch}"),
    }
}

pub fn resolve_launch(
    kind: &str,
    configured: Option<&str>,
    registry_json: Option<&str>,
) -> Result<(String, Vec<String>), coordy_protocol::CoordyError> {
    let kind = kind.trim();
    if (kind.is_empty() || kind == "acp")
        && configured
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_some()
    {
        return split_command(configured.unwrap());
    }
    let catalog = discover(registry_json);
    if !kind.is_empty() && kind != "acp" {
        if let Some(agent) = catalog.iter().find(|a| a.id == kind) {
            return split_command(&agent.command);
        }
        return Err(CoordyError::unavailable(format!(
            "runtime `{kind}` is not discovered on PATH or in the ACP registry cache"
        )));
    }
    if let Some(installed) = catalog
        .iter()
        .find(|a| a.installed && a.id != "coordy-stub")
    {
        return split_command(&installed.command);
    }
    if let Some(stub) = catalog.iter().find(|a| a.id == "coordy-stub") {
        return split_command(&stub.command);
    }
    if let Some(raw) = configured.map(str::trim).filter(|s| !s.is_empty()) {
        return split_command(raw);
    }
    Err(coordy_protocol::CoordyError::unavailable(
        "no ACP agent discovered on PATH and no registry launch command available",
    ))
}
