//! Localhost REST + WebSocket server and notes-dir watcher.
//!
//! Binds `127.0.0.1` ONLY (never 0.0.0.0), port 4949 (`FLOATNOTES_PORT`
//! override, fail-loud — no silent fallback port). Every broadcast is also
//! logged to stdout: that log line is the primary verification signal.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path as AxumPath, State, WebSocketUpgrade};
use axum::http::{header, HeaderValue, Method, Request, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::store::{self, file_mtime, NoteStore, StoreError};

pub const DEFAULT_PORT: u16 = 4949;
/// Vite dev server (see vite.config.ts server.port — strictPort).
const VITE_DEV_PORT: u16 = 1420;
const DEBOUNCE: Duration = Duration::from_millis(200);

/// `{type: "note-changed"|"note-deleted"|"notes-reindexed", id, mtime}`
#[derive(Debug, Clone, Serialize)]
pub struct Event {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
    pub mtime: Option<u64>,
}

impl Event {
    pub fn changed(id: impl Into<String>, mtime: u64) -> Self {
        Self { kind: "note-changed".into(), id: id.into(), mtime: Some(mtime) }
    }

    pub fn deleted(id: impl Into<String>) -> Self {
        Self { kind: "note-deleted".into(), id: id.into(), mtime: None }
    }

    pub fn reindexed() -> Self {
        Self { kind: "notes-reindexed".into(), id: String::new(), mtime: None }
    }
}

/// Log + send. The stdout line is part of the contract (verification signal).
pub fn broadcast_event(tx: &broadcast::Sender<Event>, event: Event) {
    let json = serde_json::to_string(&event).expect("event serializes");
    println!("[ws] {json}");
    // No subscribers yet is fine — the log line still happened.
    let _ = tx.send(event);
}

#[derive(Clone)]
struct AppState {
    store: NoteStore,
    tx: broadcast::Sender<Event>,
}

pub fn router(store: NoteStore, tx: broadcast::Sender<Event>) -> Router {
    let state = AppState { store, tx };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/notes", get(list_notes).post(create_note))
        .route(
            "/api/notes/{id}",
            get(read_note).put(update_note).delete(delete_note),
        )
        .route("/ws", get(ws_upgrade))
        .with_state(state)
        .layer(middleware::from_fn(cors));
    add_frontend(router)
}

/// Permissive CORS: the Tauri webview's page origin (Vite `127.0.0.1:1420`
/// in dev, `tauri://localhost` in release) differs from this server's, so
/// its `fetch` calls are cross-origin. The server binds loopback only, so
/// `*` exposes nothing beyond what any local process can already reach.
async fn cors(req: Request<Body>, next: Next) -> Response {
    let response = if req.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response() // preflight
    } else {
        next.run(req).await
    };
    with_cors_headers(response)
}

fn with_cors_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response
}

/// Dev: proxy everything non-API to the Vite server. Release: serve the
/// built `dist/` from disk (env `FLOATNOTES_DIST`, default: dist next to the
/// bundled Resources, falling back to ./dist for `cargo run --release`).
#[cfg(debug_assertions)]
fn add_frontend(router: Router) -> Router {
    router.fallback(proxy_to_vite)
}

#[cfg(not(debug_assertions))]
fn add_frontend(router: Router) -> Router {
    router.fallback(serve_dist)
}

#[cfg(not(debug_assertions))]
async fn serve_dist(uri: Uri) -> Response {
    let dist = std::env::var("FLOATNOTES_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|p| p.join("../Resources/dist")))
                .filter(|p| p.is_dir())
                .unwrap_or_else(|| PathBuf::from("dist"))
        });
    let rel = uri.path().trim_start_matches('/');
    // No traversal; unknown routes fall back to index.html (SPA).
    let candidate = if rel.is_empty() || rel.contains("..") {
        dist.join("index.html")
    } else {
        let p = dist.join(rel);
        if p.is_file() { p } else { dist.join("index.html") }
    };
    match tokio::fs::read(&candidate).await {
        Ok(bytes) => {
            let mime = match candidate.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "text/javascript",
                Some("css") => "text/css",
                Some("svg") => "image/svg+xml",
                Some("png") => "image/png",
                Some("ico") => "image/x-icon",
                Some("woff2") => "font/woff2",
                _ => "application/octet-stream",
            };
            ([("content-type", mime)], bytes).into_response()
        }
        Err(e) => (
            StatusCode::NOT_FOUND,
            format!("dist not found at {}: {e}", dist.display()),
        )
            .into_response(),
    }
}

#[cfg(debug_assertions)]
async fn proxy_to_vite(req: Request<Body>) -> Response {
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;

    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let uri: Uri = match format!("http://127.0.0.1:{VITE_DEV_PORT}{path_and_query}").parse() {
        Ok(uri) => uri,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("bad proxy uri: {e}")).into_response()
        }
    };
    let (mut parts, body) = req.into_parts();
    parts.uri = uri;
    let client: Client<_, Body> = Client::builder(TokioExecutor::new()).build_http();
    match client.request(Request::from_parts(parts, body)).await {
        Ok(resp) => resp.map(Body::new).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("vite dev proxy ({VITE_DEV_PORT}): {e}"),
        )
            .into_response(),
    }
}

/// Bind 127.0.0.1:<port> and serve forever. Errors are returned (not
/// swallowed) so the caller can surface them in the panel — fail-fast, no
/// silent fallback port.
pub async fn serve(store: NoteStore, tx: broadcast::Sender<Event>) -> Result<(), String> {
    let port = match std::env::var("FLOATNOTES_PORT") {
        Ok(raw) => raw
            .parse::<u16>()
            .map_err(|e| format!("invalid FLOATNOTES_PORT {raw:?}: {e}"))?,
        Err(_) => DEFAULT_PORT,
    };
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("could not bind 127.0.0.1:{port}: {e}"))?;
    println!("[floatnotes] serving on http://127.0.0.1:{port}");
    axum::serve(listener, router(store, tx))
        .await
        .map_err(|e| format!("server error: {e}"))
}

// ---------------------------------------------------------------- handlers

async fn health() -> &'static str {
    "ok"
}

async fn list_notes(State(state): State<AppState>) -> Result<Json<Vec<store::NoteMeta>>, ApiError> {
    Ok(Json(state.store.list()?))
}

#[derive(Deserialize)]
struct CreateBody {
    content: String,
}

async fn create_note(
    State(state): State<AppState>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<store::Note>), ApiError> {
    let note = state.store.create(&body.content)?;
    broadcast_event(&state.tx, Event::changed(note.id.clone(), note.mtime));
    Ok((StatusCode::CREATED, Json(note)))
}

async fn read_note(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<store::Note>, ApiError> {
    Ok(Json(state.store.read(&id)?))
}

#[derive(Deserialize)]
struct UpdateBody {
    content: String,
    /// Client's last-known mtime — 409 on mismatch.
    mtime: u64,
}

async fn update_note(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(body): Json<UpdateBody>,
) -> Result<Json<store::Note>, ApiError> {
    let note = state.store.update(&id, &body.content, body.mtime)?;
    broadcast_event(&state.tx, Event::changed(note.id.clone(), note.mtime));
    Ok(Json(note))
}

async fn delete_note(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    state.store.delete(&id)?;
    broadcast_event(&state.tx, Event::deleted(id));
    Ok(StatusCode::NO_CONTENT)
}

async fn ws_upgrade(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    let rx = state.tx.subscribe();
    ws.on_upgrade(move |socket| ws_stream(socket, rx))
}

async fn ws_stream(mut socket: WebSocket, mut rx: broadcast::Receiver<Event>) {
    loop {
        match rx.recv().await {
            Ok(event) => {
                let json = serde_json::to_string(&event).expect("event serializes");
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break; // client gone
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                // Slow consumer missed events — tell it to reindex.
                let json =
                    serde_json::to_string(&Event::reindexed()).expect("event serializes");
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

/// Store errors → HTTP: NotFound 404, Conflict 409 (with server mtime),
/// InvalidId 400, Io 500.
struct ApiError(StoreError);

impl From<StoreError> for ApiError {
    fn from(e: StoreError) -> Self {
        Self(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self.0 {
            StoreError::NotFound(id) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "not found", "id": id })),
            )
                .into_response(),
            StoreError::InvalidId(id) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "invalid id", "id": id })),
            )
                .into_response(),
            StoreError::Conflict { id, server_mtime } => (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "mtime conflict",
                    "id": id,
                    "mtime": server_mtime,
                })),
            )
                .into_response(),
            StoreError::Io(e) => {
                eprintln!("[floatnotes] store io error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response()
            }
        }
    }
}

// ---------------------------------------------------------------- watcher

/// Watch the notes dir; debounce ~200ms; skip dotfiles (sidecar, temp files)
/// and `.trash/`; broadcast note-changed / note-deleted per affected `.md`.
/// The returned watcher must be kept alive for the app's lifetime.
pub fn spawn_watcher(
    dir: PathBuf,
    tx: broadcast::Sender<Event>,
) -> notify::Result<RecommendedWatcher> {
    let (raw_tx, raw_rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = raw_tx.send(res);
    })?;
    // NonRecursive: events inside .trash/ never reach us.
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    std::thread::spawn(move || {
        while let Ok(first) = raw_rx.recv() {
            let mut paths: Vec<PathBuf> = Vec::new();
            collect_note_paths(&dir, first, &mut paths);
            // Debounce: keep draining until the dir has been quiet ~200ms.
            let mut deadline = Instant::now() + DEBOUNCE;
            loop {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match raw_rx.recv_timeout(deadline - now) {
                    Ok(event) => {
                        collect_note_paths(&dir, event, &mut paths);
                        deadline = Instant::now() + DEBOUNCE;
                    }
                    Err(_) => break,
                }
            }
            for path in paths {
                let id = match path.file_stem().and_then(|s| s.to_str()) {
                    Some(stem) => stem.to_string(),
                    None => continue,
                };
                let event = match file_mtime(&path) {
                    Ok(mtime) => Event::changed(id, mtime),
                    Err(_) => Event::deleted(id), // gone (deleted/trashed/renamed away)
                };
                broadcast_event(&tx, event);
            }
        }
    });
    Ok(watcher)
}

/// Keep only direct-child `.md` files that aren't dotfiles (sidecar, `.tmp-*`)
/// — dedup by path.
fn collect_note_paths(dir: &PathBuf, event: notify::Result<notify::Event>, out: &mut Vec<PathBuf>) {
    let Ok(event) = event else { return };
    for path in event.paths {
        if path.parent() != Some(dir.as_path()) {
            continue; // .trash/ internals etc.
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') || !name.ends_with(".md") {
            continue;
        }
        if !out.contains(&path) {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use tower::util::ServiceExt;

    fn test_app() -> (tempfile::TempDir, NoteStore, Router) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = NoteStore::open(dir.path()).expect("open store");
        let (tx, _rx) = broadcast::channel(64);
        let router = router(store.clone(), tx);
        (dir, store, router)
    }

    #[tokio::test]
    async fn api_responses_carry_cors_headers_for_the_webview() {
        let (_tmp, _store, app) = test_app();
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            "*"
        );

        // Preflight for PUT/POST/DELETE with a JSON body.
        let resp = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/notes/some-id")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        assert!(resp
            .headers()
            .get("access-control-allow-methods")
            .is_some());
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let (_tmp, _store, app) = test_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn post_creates_note_and_get_lists_it() {
        let (_tmp, store, app) = test_app();
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/notes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "content": "# Hello\ntest" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let note: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(note["title"], "Hello");
        assert!(note["id"].as_str().unwrap().starts_with("hello-"));
        assert_eq!(store.list().unwrap().len(), 1);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn put_with_stale_mtime_returns_409() {
        let (_tmp, store, app) = test_app();
        let note = store.create("# Hello").unwrap();

        let stale = serde_json::json!({ "content": "clobber", "mtime": note.mtime + 1 });
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/notes/{}", note.id))
                    .header("content-type", "application/json")
                    .body(Body::from(stale.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CONFLICT);

        let fresh = serde_json::json!({ "content": "# Updated", "mtime": note.mtime });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/notes/{}", note.id))
                    .header("content-type", "application/json")
                    .body(Body::from(fresh.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(store.read(&note.id).unwrap().content, "# Updated");
    }

    #[tokio::test]
    async fn delete_returns_204_and_404s_after() {
        let (_tmp, store, app) = test_app();
        let note = store.create("# Bye").unwrap();
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/notes/{}", note.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/notes/{}", note.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn watcher_broadcasts_external_edits_and_skips_dotfiles() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = NoteStore::open(dir.path()).expect("open store");
        let (tx, mut rx) = broadcast::channel(64);
        let _watcher = spawn_watcher(store.dir().to_path_buf(), tx).expect("watcher");
        // FSEvents needs a beat to arm before the first write.
        tokio::time::sleep(Duration::from_millis(300)).await;

        // Dotfiles / sidecar must NOT broadcast.
        std::fs::write(store.dir().join(store::SIDECAR_NAME), "{}").unwrap();
        // A real external note edit must.
        std::fs::write(store.dir().join("external-abc123.md"), "# External").unwrap();

        let event = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("watcher event within 5s")
            .expect("channel open");
        assert_eq!(event.kind, "note-changed");
        assert_eq!(event.id, "external-abc123");
        assert!(event.mtime.is_some());

        // Nothing queued for the sidecar write.
        assert!(matches!(
            rx.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }
}
