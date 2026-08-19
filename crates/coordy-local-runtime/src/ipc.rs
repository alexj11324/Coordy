use std::path::Path;
use std::sync::Arc;

use coordy_protocol::{
    Actor, AuthenticatedCommand, AuthorizedQuery, CoordyError, Handshake, HandshakeAck, Query,
    RpcRequest, RpcResponse, View, PRODUCT_VERSION, PROTOCOL_VERSION,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

use crate::Runtime;

const MAX_FRAME: usize = 16 * 1024 * 1024;

pub async fn serve(runtime: Arc<Runtime>) -> Result<(), CoordyError> {
    #[cfg(unix)]
    {
        serve_unix(runtime).await
    }
    #[cfg(windows)]
    {
        serve_windows(runtime).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = runtime;
        Err(CoordyError::unavailable(
            "local RPC is only implemented for Unix sockets and Windows named pipes",
        ))
    }
}

#[cfg(unix)]
async fn serve_unix(runtime: Arc<Runtime>) -> Result<(), CoordyError> {
    if let Some(parent) = runtime.socket_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| CoordyError::unavailable(format!("socket dir: {e}")))?;
    }
    let _ = std::fs::remove_file(&runtime.socket_path);
    let listener = UnixListener::bind(&runtime.socket_path)
        .map_err(|e| CoordyError::unavailable(format!("bind socket: {e}")))?;
    tracing::info!(path = %runtime.socket_path.display(), "coordyd listening");
    loop {
        let (stream, _) = listener
            .accept()
            .await
            .map_err(|e| CoordyError::unavailable(format!("accept: {e}")))?;
        let runtime = Arc::clone(&runtime);
        tokio::spawn(async move {
            if let Err(err) = handle_conn(runtime, stream).await {
                tracing::warn!("rpc connection closed: {}", err);
            }
        });
    }
}

#[cfg(windows)]
async fn serve_windows(runtime: Arc<Runtime>) -> Result<(), CoordyError> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let name = runtime.socket_path.to_string_lossy().to_string();
    tracing::info!(pipe = %name, "coordyd listening");
    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(false)
            .create(&name)
            .map_err(|e| CoordyError::unavailable(format!("named pipe: {e}")))?;
        server
            .connect()
            .await
            .map_err(|e| CoordyError::unavailable(format!("pipe connect: {e}")))?;
        let runtime = Arc::clone(&runtime);
        tokio::spawn(async move {
            if let Err(err) = handle_conn(runtime, server).await {
                tracing::warn!("rpc connection closed: {}", err);
            }
        });
    }
}

async fn handle_conn<S>(runtime: Arc<Runtime>, mut stream: S) -> Result<(), CoordyError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let hello = read_frame(&mut stream).await?;
    let hs: Handshake = serde_json::from_slice(&hello)
        .map_err(|e| CoordyError::invalid(format!("handshake: {e}")))?;
    if hs.protocol != PROTOCOL_VERSION || hs.token != runtime.token {
        let ack = HandshakeAck {
            ok: false,
            version: PRODUCT_VERSION.into(),
            protocol: PROTOCOL_VERSION.into(),
        };
        write_frame(&mut stream, &serde_json::to_vec(&ack).unwrap()).await?;
        return Err(CoordyError::denied("handshake rejected"));
    }
    let ack = HandshakeAck {
        ok: true,
        version: PRODUCT_VERSION.into(),
        protocol: PROTOCOL_VERSION.into(),
    };
    write_frame(&mut stream, &serde_json::to_vec(&ack).unwrap()).await?;

    loop {
        let frame = match read_frame(&mut stream).await {
            Ok(f) => f,
            Err(_) => break,
        };
        let req: RpcRequest = serde_json::from_slice(&frame)
            .map_err(|e| CoordyError::invalid(format!("rpc: {e}")))?;
        let resp = dispatch(&runtime, req).await;
        let body = serde_json::to_vec(&resp)
            .map_err(|e| CoordyError::unavailable(format!("encode: {e}")))?;
        write_frame(&mut stream, &body).await?;
        if !resp.ok && resp.error.as_ref().is_some_and(|e| e.code == "shutdown") {
            break;
        }
    }
    Ok(())
}

async fn dispatch(runtime: &Runtime, req: RpcRequest) -> RpcResponse {
    match req {
        RpcRequest::Health { id } => match runtime
            .kernel
            .view(AuthorizedQuery {
                actor: Actor::Daemon,
                query: Query::Health,
            })
            .await
        {
            Ok(View::Health(h)) => ok(id, serde_json::to_value(h).unwrap()),
            Ok(_) => err(id, CoordyError::unavailable("unexpected health view")),
            Err(e) => err(id, e),
        },
        RpcRequest::Submit { id, command } => match runtime.submit_and_persist(*command) {
            Ok(outcome) => ok(id, serde_json::to_value(outcome).unwrap()),
            Err(e) => err(id, e),
        },
        RpcRequest::View { id, query } => match runtime.kernel.view(query).await {
            Ok(view) => ok(id, serde_json::to_value(view).unwrap()),
            Err(e) => err(id, e),
        },
        RpcRequest::Subscribe { id, cursor } => {
            let effects = runtime.kernel.watch(cursor);
            ok(id, serde_json::to_value(effects).unwrap())
        }
        RpcRequest::Shutdown { id } => err(id, CoordyError::new("shutdown", "daemon stopping")),
        RpcRequest::SecretsStatus { id } => {
            let status = crate::SecretStore::open(&runtime.data_dir).status();
            ok(id, serde_json::to_value(status).unwrap())
        }
        RpcRequest::SetSecret {
            id,
            provider,
            api_key,
            base_url,
            acp_command,
        } => match crate::SecretStore::open(&runtime.data_dir).set(
            provider,
            api_key,
            base_url,
            acp_command,
        ) {
            Ok(status) => ok(id, serde_json::to_value(status).unwrap()),
            Err(e) => err(id, e),
        },
        RpcRequest::ClearSecret { id } => {
            match crate::SecretStore::open(&runtime.data_dir).clear() {
                Ok(status) => ok(id, serde_json::to_value(status).unwrap()),
                Err(e) => err(id, e),
            }
        }
        RpcRequest::DiscoverAgents { id, refresh } => {
            let agents = crate::discovery::list_agents(&runtime.data_dir, refresh).await;
            ok(id, serde_json::to_value(agents).unwrap())
        }
        RpcRequest::ImportDiscoveredAgents {
            id,
            workspace_id,
            principal_id,
            ids,
        } => {
            match crate::discovery::import_agents(runtime, workspace_id, principal_id, ids).await {
                Ok(result) => ok(id, serde_json::to_value(result).unwrap()),
                Err(e) => err(id, e),
            }
        }
        RpcRequest::SuggestTaskSplit {
            id,
            workspace_id,
            task_id,
            principal_id,
        } => {
            match crate::suggest::suggest_task_split(
                runtime,
                &workspace_id,
                &task_id,
                &principal_id,
            )
            .await
            {
                Ok(result) => ok(id, serde_json::to_value(result).unwrap()),
                Err(e) => err(id, e),
            }
        }
    }
}

fn ok(id: String, result: serde_json::Value) -> RpcResponse {
    RpcResponse {
        id,
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn err(id: String, error: CoordyError) -> RpcResponse {
    RpcResponse {
        id,
        ok: false,
        result: None,
        error: Some(error),
    }
}

async fn read_frame<S: AsyncRead + Unpin>(stream: &mut S) -> Result<Vec<u8>, CoordyError> {
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| CoordyError::unavailable(format!("read len: {e}")))?;
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_FRAME {
        return Err(CoordyError::invalid("frame too large"));
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .await
        .map_err(|e| CoordyError::unavailable(format!("read body: {e}")))?;
    Ok(buf)
}

async fn write_frame<S: AsyncWrite + Unpin>(
    stream: &mut S,
    body: &[u8],
) -> Result<(), CoordyError> {
    let len = (body.len() as u32).to_le_bytes();
    stream
        .write_all(&len)
        .await
        .map_err(|e| CoordyError::unavailable(format!("write len: {e}")))?;
    stream
        .write_all(body)
        .await
        .map_err(|e| CoordyError::unavailable(format!("write body: {e}")))?;
    stream
        .flush()
        .await
        .map_err(|e| CoordyError::unavailable(format!("flush: {e}")))?;
    Ok(())
}

#[cfg(unix)]
type IpcStream = UnixStream;
#[cfg(windows)]
type IpcStream = tokio::net::windows::named_pipe::NamedPipeClient;

pub struct RpcClient {
    stream: IpcStream,
}

impl RpcClient {
    pub async fn connect(path: &Path, token: &str) -> Result<Self, CoordyError> {
        let mut stream = connect_stream(path).await?;
        let hs = Handshake {
            protocol: PROTOCOL_VERSION.into(),
            token: token.into(),
            client: "cli".into(),
        };
        write_frame(&mut stream, &serde_json::to_vec(&hs).unwrap()).await?;
        let ack_raw = read_frame(&mut stream).await?;
        let ack: HandshakeAck = serde_json::from_slice(&ack_raw)
            .map_err(|e| CoordyError::invalid(format!("ack: {e}")))?;
        if !ack.ok {
            return Err(CoordyError::denied("daemon handshake failed"));
        }
        Ok(Self { stream })
    }

    pub async fn request(&mut self, req: RpcRequest) -> Result<RpcResponse, CoordyError> {
        write_frame(&mut self.stream, &serde_json::to_vec(&req).unwrap()).await?;
        let raw = read_frame(&mut self.stream).await?;
        serde_json::from_slice(&raw).map_err(|e| CoordyError::invalid(format!("response: {e}")))
    }

    pub async fn submit(
        &mut self,
        command: AuthenticatedCommand,
    ) -> Result<RpcResponse, CoordyError> {
        self.request(RpcRequest::Submit {
            id: uuid::Uuid::new_v4().to_string(),
            command: Box::new(command),
        })
        .await
    }

    pub async fn view(&mut self, query: AuthorizedQuery) -> Result<RpcResponse, CoordyError> {
        self.request(RpcRequest::View {
            id: uuid::Uuid::new_v4().to_string(),
            query,
        })
        .await
    }

    pub async fn subscribe(&mut self, cursor: Option<u64>) -> Result<RpcResponse, CoordyError> {
        self.request(RpcRequest::Subscribe {
            id: uuid::Uuid::new_v4().to_string(),
            cursor,
        })
        .await
    }

    pub async fn health(&mut self) -> Result<RpcResponse, CoordyError> {
        self.request(RpcRequest::Health {
            id: uuid::Uuid::new_v4().to_string(),
        })
        .await
    }
}

#[cfg(unix)]
async fn connect_stream(path: &Path) -> Result<IpcStream, CoordyError> {
    UnixStream::connect(path)
        .await
        .map_err(|e| CoordyError::unavailable(format!("connect: {e}")))
}

#[cfg(windows)]
async fn connect_stream(path: &Path) -> Result<IpcStream, CoordyError> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let name = path.to_string_lossy().to_string();
    ClientOptions::new()
        .open(&name)
        .map_err(|e| CoordyError::unavailable(format!("pipe open: {e}")))
}

pub async fn connect(path: &Path, token: &str) -> Result<RpcClient, CoordyError> {
    RpcClient::connect(path, token).await
}
