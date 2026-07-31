//! Localhost REST + WebSocket server and notes-dir watcher.
//!
//! Binds `127.0.0.1` ONLY (never 0.0.0.0), port 4949 (`FLOATNOTES_PORT`
//! override, fail-loud — no silent fallback port). Every broadcast is also
//! logged to stdout: that log line is the primary verification signal.

use std::path::PathBuf;
use std::sync::Arc;
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
    let origins = Arc::new(allowed_origins());
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/notes", get(list_notes).post(create_note))
        .route(
            "/api/notes/{id}",
            get(read_note).put(update_note).delete(delete_note),
        )
        .route("/api/notes/{id}/restore", axum::routing::post(restore_note))
        .route("/api/sidecar", get(read_sidecar).put(write_sidecar))
        .route("/ws", get(ws_upgrade))
        .with_state(state)
        .layer(middleware::from_fn_with_state(origins, cors));
    add_frontend(router)
}

/// The only origins whose browser `fetch` may touch this API.
///
/// This list used to be `*`, on the reasoning that a loopback-only bind
/// "exposes nothing beyond what any local process can already reach". That
/// reasoning is wrong, and the 2026-07-30 audit measured it: a *web page* is
/// not a local process, and it borrows the user's browser to reach loopback.
/// Chromium happens to block this via Private Network Access, but WebKit 26.5
/// and Firefox 153 do not — both read the entire notes corpus cross-origin and
/// accepted `POST 201` / `DELETE 204`. Safari is the macOS default browser.
/// See `audit-output/security/cors-non-chromium.md`.
fn allowed_origins() -> Vec<String> {
    // serve() validates FLOATNOTES_PORT and fails loudly before any request is
    // handled, so an unparseable value can never reach this point in the app;
    // in tests the var is unset. DEFAULT_PORT is the honest value either way.
    let port = configured_port().unwrap_or(DEFAULT_PORT);
    vec![
        // Release: the Tauri webview serves the bundled dist over its own
        // protocol, so its fetches to this server are cross-origin.
        "tauri://localhost".to_string(),
        // Dev: the page is Vite's; `api.ts` points it back here.
        format!("http://localhost:{VITE_DEV_PORT}"),
        format!("http://127.0.0.1:{VITE_DEV_PORT}"),
        // Our own origin. Same-origin GETs send no Origin header, but
        // same-origin POST/PUT/DELETE do — and docs/ux-testing.md's whole L2
        // layer drives the app as a plain page here.
        format!("http://localhost:{port}"),
        format!("http://127.0.0.1:{port}"),
    ]
}

/// Gate every request on `Origin`, then echo back only what we allow.
async fn cors(
    State(allowed): State<Arc<Vec<String>>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let Some(origin) = req.headers().get(header::ORIGIN).cloned() else {
        // No Origin: not a browser cross-origin request at all — curl, the
        // `note` CLI, a same-origin GET. There is nothing to authorise, and
        // adding CORS headers to the response would be meaningless.
        return next.run(req).await;
    };

    let permitted = origin
        .to_str()
        .is_ok_and(|o| allowed.iter().any(|a| a == o));

    if !permitted {
        // Refuse *before* the handler runs. Merely withholding the
        // Access-Control-Allow-Origin header would only stop the browser from
        // reading the response — a simple GET, or a `text/plain` POST, would
        // still reach the store and take effect. The read is what the audit
        // demonstrated; the write is what withholding a header would miss.
        return StatusCode::FORBIDDEN.into_response();
    }

    let response = if req.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response() // preflight
    } else {
        next.run(req).await
    };
    with_cors_headers(response, origin)
}

fn with_cors_headers(mut response: Response, origin: HeaderValue) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    // The response now varies by request origin; without this a shared cache
    // could hand one origin's allowance to another.
    headers.insert(header::VARY, HeaderValue::from_static("origin"));
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

/// Vite's port, `FLOATNOTES_VITE_PORT` override (fail-loud, like
/// `FLOATNOTES_PORT`). The override exists so the proxy can be pointed at a
/// stub upstream in tests without fighting a real `bun run dev` for 1420.
#[cfg(debug_assertions)]
fn vite_dev_port() -> u16 {
    match std::env::var("FLOATNOTES_VITE_PORT") {
        Ok(raw) => raw
            .parse()
            .unwrap_or_else(|e| panic!("invalid FLOATNOTES_VITE_PORT {raw:?}: {e}")),
        Err(_) => VITE_DEV_PORT,
    }
}

#[cfg(debug_assertions)]
async fn proxy_to_vite(mut req: Request<Body>) -> Response {
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::{TokioExecutor, TokioIo};

    let port = vite_dev_port();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let uri: Uri = match format!("http://127.0.0.1:{port}{path_and_query}").parse() {
        Ok(uri) => uri,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("bad proxy uri: {e}")).into_response()
        }
    };

    // Claim the downstream half of a potential protocol upgrade BEFORE the
    // request is consumed. Forwarding the 101 alone is not enough: without
    // splicing the two upgraded sockets the Vite HMR WebSocket connects, goes
    // silent, and its client reload-loops on "server connection lost"
    // (~40 reloads/s, app never mounts). Cheap when there is no upgrade —
    // the future simply never resolves and is dropped with the response.
    let downstream_upgrade = hyper::upgrade::on(&mut req);

    let (mut parts, body) = req.into_parts();
    parts.uri = uri;
    let client: Client<_, Body> = Client::builder(TokioExecutor::new()).build_http();
    match client.request(Request::from_parts(parts, body)).await {
        Ok(mut upstream) if upstream.status() == StatusCode::SWITCHING_PROTOCOLS => {
            let upstream_upgrade = hyper::upgrade::on(&mut upstream);
            tokio::spawn(async move {
                // `downstream_upgrade` only resolves once axum has written the
                // 101 back, so this has to run off the response path.
                match tokio::try_join!(downstream_upgrade, upstream_upgrade) {
                    Ok((down, up)) => {
                        let (mut down, mut up) = (TokioIo::new(down), TokioIo::new(up));
                        if let Err(e) = tokio::io::copy_bidirectional(&mut down, &mut up).await {
                            eprintln!("[proxy] upgraded stream ended: {e}");
                        }
                    }
                    Err(e) => eprintln!("[proxy] upgrade handoff failed: {e}"),
                }
            });
            // Drop the upstream body: after a 101 the bytes belong to the
            // spliced stream, not to this response.
            let (parts, _) = upstream.into_parts();
            Response::from_parts(parts, Body::empty())
        }
        Ok(resp) => resp.map(Body::new).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            format!("vite dev proxy ({port}): {e}"),
        )
            .into_response(),
    }
}

/// The port we listen on: `FLOATNOTES_PORT` if set, else [`DEFAULT_PORT`].
/// Fail-loud on an unparseable value — never a silent fallback port.
fn configured_port() -> Result<u16, String> {
    match std::env::var("FLOATNOTES_PORT") {
        Ok(raw) => raw
            .parse::<u16>()
            .map_err(|e| format!("invalid FLOATNOTES_PORT {raw:?}: {e}")),
        Err(_) => Ok(DEFAULT_PORT),
    }
}

/// Bind 127.0.0.1:<port> and serve forever. Errors are returned (not
/// swallowed) so the caller can surface them in the panel — fail-fast, no
/// silent fallback port.
pub async fn serve(store: NoteStore, tx: broadcast::Sender<Event>) -> Result<(), String> {
    let port = configured_port()?;
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

/// Undo of DELETE (ADR 0004): rename back out of `.trash/`.
async fn restore_note(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<store::Note>, ApiError> {
    let note = state.store.restore(&id)?;
    broadcast_event(&state.tx, Event::changed(note.id.clone(), note.mtime));
    Ok(Json(note))
}

/// Sidecar (pins / order / zoom). Served over REST so the plain-browser UI
/// at :4949 shares the same pins as the panel — localStorage would silo them.
async fn read_sidecar(State(state): State<AppState>) -> Json<store::Sidecar> {
    Json(state.store.sidecar_load())
}

async fn write_sidecar(
    State(state): State<AppState>,
    Json(sidecar): Json<store::Sidecar>,
) -> Result<StatusCode, ApiError> {
    state.store.sidecar_save(&sidecar)?;
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
        // The release webview's origin — echoed back, not `*`.
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/notes")
                    .header("origin", "tauri://localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            "tauri://localhost"
        );
        assert_eq!(resp.headers().get("vary").unwrap(), "origin");

        // Preflight for PUT/POST/DELETE with a JSON body.
        let resp = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/notes/some-id")
                    .header("origin", "http://127.0.0.1:1420")
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

    /// The finding itself: a page on the open web, in a browser that does not
    /// implement Private Network Access, must not be able to read the notes.
    #[tokio::test]
    async fn a_foreign_origin_cannot_read_the_notes() {
        let (_tmp, store, app) = test_app();
        store.create("secret note").expect("seed a note");

        for origin in ["https://evil.example", "http://evil.example", "null"] {
            let resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/notes")
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                resp.status(),
                StatusCode::FORBIDDEN,
                "origin {origin} should be refused outright"
            );
            assert!(
                resp.headers().get("access-control-allow-origin").is_none(),
                "origin {origin} must not be echoed back"
            );
        }
    }

    /// Refusal has to happen before the handler, not just in the response
    /// headers — otherwise the delete still takes effect and only the
    /// confirmation is hidden from the caller.
    #[tokio::test]
    async fn a_foreign_origin_cannot_delete_a_note() {
        let (_tmp, store, app) = test_app();
        let note = store.create("keep me").expect("seed a note");

        let resp = app
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/notes/{}", note.id))
                    .header("origin", "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert!(
            store.read(&note.id).is_ok(),
            "the note must still exist — a refused request must have no effect"
        );
    }

    /// Non-browser callers (curl, the `note` CLI) send no Origin at all and
    /// must keep working: CORS governs browsers, not local processes.
    #[tokio::test]
    async fn a_request_without_an_origin_is_untouched() {
        let (_tmp, _store, app) = test_app();
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
        assert!(resp.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn the_webview_dev_server_and_self_origins_are_allowed() {
        let (_tmp, _store, app) = test_app();
        for origin in [
            "tauri://localhost",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "http://localhost:4949",
            "http://127.0.0.1:4949",
        ] {
            let resp = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/notes")
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK, "origin {origin} rejected");
            assert_eq!(
                resp.headers().get("access-control-allow-origin").unwrap(),
                origin,
                "origin {origin} should be echoed verbatim"
            );
        }
    }

    /// WebSockets are exempt from CORS in the browser but still carry Origin,
    /// and /ws streams every note change — so it needs the same gate. The
    /// middleware runs ahead of the handshake, so a bare request is enough to
    /// show the gate covers this route.
    #[tokio::test]
    async fn a_foreign_origin_cannot_reach_the_event_socket() {
        let (_tmp, _store, app) = test_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/ws")
                    .header("origin", "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
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

    /// Dev-only regression: the Vite HMR WebSocket has to survive the :4949
    /// proxy. Forwarding the 101 without splicing the upgraded sockets left
    /// the HMR client connected-but-deaf, so it looped on "server connection
    /// lost" ~40×/s and the app never mounted (todo af35991c). A stub Vite
    /// echoes one frame; the bytes only arrive if both halves are bridged.
    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn dev_proxy_bridges_the_upgraded_websocket_stream() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        async fn echo_ws(ws: WebSocketUpgrade) -> Response {
            ws.on_upgrade(|mut socket: WebSocket| async move {
                while let Some(Ok(msg)) = socket.recv().await {
                    if let Message::Text(text) = msg {
                        let _ = socket.send(Message::Text(text)).await;
                    }
                }
            })
        }

        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = upstream.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(upstream, Router::new().route("/vite-hmr", get(echo_ws)))
                .await
                .unwrap()
        });
        std::env::set_var("FLOATNOTES_VITE_PORT", upstream_port.to_string());

        let (_tmp, _store, app) = test_app();
        let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_port = proxy.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(proxy, app).await.unwrap() });

        // 16 zero-ish bytes, base64 — any well-formed nonce does; the test
        // never checks the derived accept, only that 101 comes back.
        let nonce = format!("{}==", "A".repeat(22));
        let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", proxy_port))
            .await
            .unwrap();
        sock.write_all(
            format!(
                "GET /vite-hmr HTTP/1.1\r\n\
                 Host: 127.0.0.1\r\n\
                 Connection: Upgrade\r\n\
                 Upgrade: websocket\r\n\
                 Sec-WebSocket-Version: 13\r\n\
                 Sec-WebSocket-Key: {nonce}\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();

        let mut head = [0u8; 512];
        let n = sock.read(&mut head).await.unwrap();
        let head = String::from_utf8_lossy(&head[..n]);
        assert!(head.starts_with("HTTP/1.1 101"), "handshake: {head}");

        // Masked client text frame "hi" (mask key 0x00000000 → payload as-is).
        // Pre-fix this byte sequence vanished into the un-bridged socket.
        sock.write_all(&[0x81, 0x82, 0, 0, 0, 0, b'h', b'i'])
            .await
            .unwrap();

        let mut echo = [0u8; 8];
        let n = tokio::time::timeout(Duration::from_secs(5), sock.read(&mut echo))
            .await
            .expect("echo within 5s — proxy never bridged the upgraded stream")
            .unwrap();
        assert_eq!(
            &echo[..n],
            &[0x81, 0x02, b'h', b'i'],
            "expected an unmasked server echo frame"
        );
    }
}
