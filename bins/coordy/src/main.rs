use std::path::PathBuf;

use clap::{Parser, Subcommand};
use coordy_local_runtime::{connect, default_paths};
use coordy_protocol::{Actor, AuthenticatedCommand, AuthorizedQuery, Command, Query};

#[derive(Parser)]
#[command(name = "coordy", about = "Coordy CLI talking to coordyd")]
struct Args {
    #[arg(long)]
    socket: Option<PathBuf>,
    #[arg(long)]
    token: Option<String>,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Health,
    Inspect,
    Workspace {
        #[arg(long)]
        name: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let (_data, default_sock) = default_paths().map_err(|e| anyhow::anyhow!(e))?;
    let socket = args.socket.unwrap_or(default_sock);
    let token = match args.token {
        Some(t) => t,
        None => {
            let path = socket
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join("coordyd.token");
            std::fs::read_to_string(path)?.trim().to_string()
        }
    };
    let mut client = connect(&socket, &token)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    match args.command {
        Cmd::Health => {
            let resp = client.health().await.map_err(|e| anyhow::anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
        Cmd::Inspect => {
            let resp = client
                .view(AuthorizedQuery {
                    actor: Actor::Daemon,
                    query: Query::Workspaces,
                })
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
        Cmd::Workspace { name } => {
            let resp = client
                .submit(AuthenticatedCommand {
                    actor: Actor::Daemon,
                    command: Command::CreateWorkspace { name },
                })
                .await
                .map_err(|e| anyhow::anyhow!(e))?;
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
    }
    Ok(())
}
