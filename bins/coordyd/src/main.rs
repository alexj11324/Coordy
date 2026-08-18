use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use coordy_local_runtime::{default_paths, generate_token, write_token_file, Runtime};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "coordyd", about = "Coordy local daemon")]
struct Args {
    #[arg(long)]
    data_dir: Option<PathBuf>,
    #[arg(long)]
    socket: Option<PathBuf>,
    #[arg(long)]
    token: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let args = Args::parse();
    let (default_data, default_sock) = default_paths().map_err(|e| anyhow::anyhow!(e))?;
    let data_dir = args.data_dir.unwrap_or(default_data);
    let socket = args.socket.unwrap_or(default_sock);
    let token = args.token.unwrap_or_else(generate_token);
    if let Some(parent) = socket.parent() {
        write_token_file(parent, &token).map_err(|e| anyhow::anyhow!(e))?;
    }
    let runtime =
        Arc::new(Runtime::open(&data_dir, &socket, token).map_err(|e| anyhow::anyhow!(e))?);
    coordy_local_runtime::serve(runtime)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(())
}
