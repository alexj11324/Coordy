use clap::Parser;
use std::time::Duration;

use coordy_control_plane::{serve, ClerkConfig, ControlPlane};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "127.0.0.1:8787")]
    bind: String,
    #[arg(long, default_value = "coordy-control-plane.sqlite3")]
    database: String,
    #[arg(long)]
    clerk_issuer: String,
    #[arg(long)]
    clerk_audience: String,
    #[arg(long, required = true)]
    clerk_authorized_party: Vec<String>,
    #[arg(long)]
    clerk_jwks_url: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();
    let args = Args::parse();
    let clerk_secret_key = std::env::var("CLERK_SECRET_KEY").map_err(|_| {
        anyhow::anyhow!("CLERK_SECRET_KEY must be provided through the server environment")
    })?;
    let state = ControlPlane::open(
        &args.database,
        ClerkConfig {
            issuer: args.clerk_issuer,
            audience: args.clerk_audience,
            authorized_parties: args.clerk_authorized_party,
            jwks_url: args.clerk_jwks_url,
            clock_skew_seconds: 5,
            jwks_cache_ttl: Duration::from_secs(300),
        },
        clerk_secret_key,
    )?;
    tracing::info!("coordy-server listening on {}", args.bind);
    serve(&args.bind, state).await?;
    Ok(())
}
