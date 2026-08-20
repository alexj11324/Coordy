//! Discover native CLI harnesses from PATH, plus ACP-registry agents that are
//! not covered by a builtin protocol family. Does not talk to the kernel.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use coordy_protocol::{CoordyError, DiscoveredAgentView};

use crate::protocol::{canonical_harness_id, display_args, ProtocolFamily, BUILTINS};

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
    Ok((bin.into(), parts.map(|s| s.to_string()).collect()))
}

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
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".opencode/bin"));
        dirs.push(home.join(".grok/bin"));
        dirs.push(home.join(".antigravity/antigravity/bin"));
        dirs.push(home.join(".antigravity-ide/antigravity-ide/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join("Library/pnpm"));
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
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[allow(clippy::too_many_arguments)]
fn view(
    id: impl Into<String>,
    name: impl Into<String>,
    installed: bool,
    command: impl Into<String>,
    source: impl Into<String>,
    version: Option<String>,
    family: ProtocolFamily,
    launch_state: &str,
) -> DiscoveredAgentView {
    DiscoveredAgentView {
        id: id.into(),
        name: name.into(),
        installed,
        launch_state: launch_state.into(),
        command: command.into(),
        source: source.into(),
        version,
        protocol_family: family.as_str().to_string(),
    }
}

pub fn discover(registry_json: Option<&str>) -> Vec<DiscoveredAgentView> {
    let mut by_id: BTreeMap<String, DiscoveredAgentView> = BTreeMap::new();

    if let Some(stub) = suggested_acp_stub_command() {
        by_id.insert(
            "coordy-stub".into(),
            view(
                "coordy-stub",
                "Coordy 演示",
                true,
                stub,
                "stub",
                None,
                ProtocolFamily::Stub,
                "ready",
            ),
        );
    }

    for spec in BUILTINS {
        let command_tail = if spec.fixed_args.is_empty() {
            display_args(spec.family).join(" ")
        } else {
            spec.fixed_args.join(" ")
        };
        if let Some(bin) = spec.bins.iter().find_map(|name| which_bin(name)) {
            let command = if command_tail.is_empty() {
                bin.display().to_string()
            } else {
                format!("{} {command_tail}", bin.display())
            };
            by_id.insert(
                spec.id.into(),
                view(
                    spec.id,
                    spec.name,
                    true,
                    command,
                    "path",
                    None,
                    spec.family,
                    "ready",
                ),
            );
        } else {
            let hint = if command_tail.is_empty() {
                spec.bins[0].to_string()
            } else {
                format!("{} {command_tail}", spec.bins[0])
            };
            by_id.insert(
                spec.id.into(),
                view(
                    spec.id,
                    spec.name,
                    false,
                    hint,
                    "builtin",
                    None,
                    spec.family,
                    "missing",
                ),
            );
        }
    }

    if let Some(text) = registry_json {
        if let Ok(file) = serde_json::from_str::<RegistryFile>(text) {
            for agent in file.agents {
                let canon = canonical_harness_id(&agent.id).to_string();
                if canon != agent.id || canon == "grok" {
                    if let Some(entry) = by_id.get_mut(&canon) {
                        if !agent.name.is_empty()
                            && entry.source != "path"
                            && entry.source != "stub"
                        {
                            entry.name = agent.name.clone();
                        }
                        entry.version = agent.version.clone().or(entry.version.clone());
                        if !entry.installed {
                            if let Some(mut command) = registry_launch(&agent) {
                                if canon == "grok" {
                                    command = strengthen_grok_registry_command(&command);
                                }
                                entry.command = command;
                                entry.source = "registry".into();
                                entry.protocol_family = ProtocolFamily::Acp.as_str().to_string();
                                entry.launch_state = "on_demand".into();
                            }
                        }
                    }
                    continue;
                }
                let fallback = registry_launch(&agent);
                let command_hint = fallback
                    .clone()
                    .or_else(|| registry_command_hint(&agent))
                    .unwrap_or_default();
                let entry = by_id.entry(agent.id.clone()).or_insert_with(|| {
                    view(
                        agent.id.clone(),
                        if agent.name.is_empty() {
                            agent.id.clone()
                        } else {
                            agent.name.clone()
                        },
                        false,
                        command_hint,
                        "registry",
                        agent.version.clone(),
                        ProtocolFamily::Acp,
                        if fallback.is_some() {
                            "on_demand"
                        } else {
                            "missing"
                        },
                    )
                });
                if !agent.name.is_empty()
                    && entry.source != "path"
                    && entry.source != "stub"
                    && entry.source != "builtin"
                {
                    entry.name = agent.name;
                }
                entry.version = agent.version.or(entry.version.clone());
                if !entry.installed {
                    if let Some(cmd) = fallback {
                        entry.command = cmd;
                        entry.source = "registry".into();
                        entry.protocol_family = ProtocolFamily::Acp.as_str().to_string();
                        entry.launch_state = "on_demand".into();
                    }
                }
            }
        }
    }

    let mut catalog: Vec<_> = by_id
        .into_values()
        .filter(|a| !a.command.trim().is_empty())
        .collect();
    catalog.sort_by(|a, b| {
        let rank = |item: &DiscoveredAgentView| match item.launch_state.as_str() {
            "ready" => 0,
            "on_demand" => 1,
            _ => 2,
        };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    catalog
}

/// Resolve the transport from the concrete discovered entry. A native identity
/// can have an ACP Registry fallback when its local binary is absent; using the
/// static builtin family in that case would advertise a runnable entry and then
/// launch the wrong executable/protocol.
pub fn launch_uses_acp(kind: &str, catalog: &[DiscoveredAgentView]) -> bool {
    let want = canonical_harness_id(kind);
    catalog
        .iter()
        .find(|item| item.id == kind || canonical_harness_id(&item.id) == want)
        .map(|item| {
            item.protocol_family == ProtocolFamily::Acp.as_str()
                || item.protocol_family == ProtocolFamily::Stub.as_str()
        })
        .unwrap_or_else(|| crate::protocol::protocol_family(kind).uses_acp())
}

fn strengthen_grok_registry_command(command: &str) -> String {
    let mut parts: Vec<&str> = command.split_whitespace().collect();
    if let Some(agent_index) = parts.iter().position(|part| *part == "agent") {
        if !parts.contains(&"--no-auto-update") {
            parts.insert(agent_index, "--no-auto-update");
        }
        let agent_index = parts
            .iter()
            .position(|part| *part == "agent")
            .unwrap_or(agent_index);
        if !parts.contains(&"--always-approve") {
            parts.insert(agent_index + 1, "--always-approve");
        }
    }
    parts.join(" ")
}

fn registry_launch(agent: &RegistryAgent) -> Option<String> {
    if let Some(npx) = &agent.distribution.npx {
        which_bin("npx")?;
        let mut parts = vec!["npx".into(), "-y".into(), npx.package.clone()];
        parts.extend(npx.args.iter().cloned());
        return Some(parts.join(" "));
    }
    if let Some(uvx) = &agent.distribution.uvx {
        which_bin("uvx")?;
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
        }
    }
    None
}

fn registry_command_hint(agent: &RegistryAgent) -> Option<String> {
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
    let binaries = agent.distribution.binary.as_ref()?;
    let key = current_binary_key();
    let spec = binaries.get(&key).or_else(|| binaries.values().next())?;
    if spec.cmd.is_empty() {
        return None;
    }
    let name = Path::new(&spec.cmd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&spec.cmd)
        .trim_start_matches("./");
    let mut parts = vec![name.to_string()];
    parts.extend(spec.args.iter().cloned());
    Some(parts.join(" "))
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
) -> Result<(String, Vec<String>), CoordyError> {
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
    let want = canonical_harness_id(kind);
    if !kind.is_empty() && kind != "acp" {
        if let Some(agent) = catalog
            .iter()
            .find(|a| a.id == kind || canonical_harness_id(&a.id) == want)
        {
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
    Err(CoordyError::unavailable(
        "no harness discovered on PATH and no registry launch command available",
    ))
}
