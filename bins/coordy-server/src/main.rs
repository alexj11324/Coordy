use clap::Parser;
use coordy_control_plane::{serve, SharedState};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "127.0.0.1:8787")]
    bind: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let args = Args::parse();
    tracing::info!("coordy-server listening on {}", args.bind);
    serve(&args.bind, SharedState::default()).await?;
    Ok(())
}
