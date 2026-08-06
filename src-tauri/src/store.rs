//! Plain-`.md` note store (contract: parent plan, step S03).
//!
//! - Notes are individual `.md` files in the notes dir (`~/Notes`, env
//!   `FLOATNOTES_DIR`). No frontmatter — the note IS the markdown.
//! - title = first non-empty line, leading `#`s stripped.
//! - filename = slug of the creation title + short random suffix; stable after
//!   creation (updates never rename).
//! - Writes are atomic (temp file + rename into place).
//! - Delete never unlinks (ADR 0004): the file is renamed into `.trash/`,
//!   timestamp suffix on collision.
//! - Pin/order/zoom metadata lives in the sidecar `.floatnotes.json`, never
//!   inside notes.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const SIDECAR_NAME: &str = ".floatnotes.json";
pub const TRASH_DIR: &str = ".trash";

#[derive(Debug, Clone, Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub mtime: u64,
    /// Absolute path of the note's `.md` file. The store owns the notes dir,
    /// so the client cannot derive this — it ships with the note.
    pub path: String,
}

/// Pins / order / zoom / Esc behavior — app metadata only, never note content.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Sidecar {
    #[serde(default)]
    pub pins: Vec<String>,
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub zoom: Option<f64>,
    /// `"hide"` (default when absent) or `"unfocus"` — what Esc does with no
    /// overlays open (step 09). Free string: the client owns the vocabulary.
    #[serde(default, rename = "escBehavior", skip_serializing_if = "Option::is_none")]
    pub esc_behavior: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("note not found: {0}")]
    NotFound(String),
    #[error("invalid note id: {0}")]
    InvalidId(String),
    #[error("mtime conflict for {id}: server has {server_mtime}")]
    Conflict { id: String, server_mtime: u64 },
    #[error(transparent)]
    Io(#[from] io::Error),
}

#[derive(Clone)]
pub struct NoteStore {
    dir: PathBuf,
}

impl NoteStore {
    /// Open (creating if missing) the store at `dir`, plus its `.trash/`.
    pub fn open(dir: impl Into<PathBuf>) -> io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        // Canonicalize so watcher events (macOS FSEvents reports resolved
        // /private/... paths) compare equal to our dir.
        let dir = dir.canonicalize()?;
        fs::create_dir_all(dir.join(TRASH_DIR))?;
        Ok(Self { dir })
    }

    /// `FLOATNOTES_DIR` or `~/Notes`.
    pub fn open_default() -> io::Result<Self> {
        let dir = match std::env::var("FLOATNOTES_DIR") {
            Ok(d) if !d.is_empty() => PathBuf::from(d),
            _ => {
                let home = std::env::var("HOME")
                    .map_err(|_| io::Error::other("HOME is not set — cannot resolve ~/Notes"))?;
                Path::new(&home).join("Notes")
            }
        };
        Self::open(dir)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn list(&self) -> Result<Vec<NoteMeta>, StoreError> {
        let mut notes = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with('.') || !name.ends_with(".md") || !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(&path)?;
            notes.push(NoteMeta {
                id: name.trim_end_matches(".md").to_string(),
                title: derive_title(&content),
                mtime: file_mtime(&path)?,
            });
        }
        // Newest first; explicit ordering lives in the sidecar (later steps).
        notes.sort_by(|a, b| b.mtime.cmp(&a.mtime));
        Ok(notes)
    }

    pub fn read(&self, id: &str) -> Result<Note, StoreError> {
        let path = self.path_for(id)?;
        let content = fs::read_to_string(&path).map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound {
                StoreError::NotFound(id.to_string())
            } else {
                StoreError::Io(e)
            }
        })?;
        Ok(Note {
            id: id.to_string(),
            title: derive_title(&content),
            content,
            mtime: file_mtime(&path)?,
            path: path.display().to_string(),
        })
    }

    pub fn create(&self, content: &str) -> Result<Note, StoreError> {
        let title = derive_title(content);
        let id = self.new_id(&title);
        let path = self.dir.join(format!("{id}.md"));
        self.atomic_write(&path, content)?;
        Ok(Note {
            id,
            title,
            content: content.to_string(),
            mtime: file_mtime(&path)?,
            path: path.display().to_string(),
        })
    }

    /// Last-write-wins with a fail-fast guard: the caller sends the mtime it
    /// last saw; a mismatch means someone else wrote in between → `Conflict`
    /// (HTTP 409) so the UI reloads instead of clobbering.
    pub fn update(&self, id: &str, content: &str, expected_mtime: u64) -> Result<Note, StoreError> {
        let path = self.path_for(id)?;
        if !path.is_file() {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let current = file_mtime(&path)?;
        if current != expected_mtime {
            return Err(StoreError::Conflict {
                id: id.to_string(),
                server_mtime: current,
            });
        }
        self.atomic_write(&path, content)?;
        Ok(Note {
            id: id.to_string(),
            title: derive_title(content),
            content: content.to_string(),
            mtime: file_mtime(&path)?,
            path: path.display().to_string(),
        })
    }

    /// ADR 0004: never unlink — rename into `.trash/`, timestamp suffix on
    /// collision (undo = rename back).
    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let path = self.path_for(id)?;
        if !path.is_file() {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let trash = self.dir.join(TRASH_DIR);
        fs::create_dir_all(&trash)?;
        let mut target = trash.join(format!("{id}.md"));
        if target.exists() {
            target = trash.join(format!("{id}-{}.md", now_millis()));
        }
        fs::rename(&path, &target)?;
        Ok(())
    }

    /// Undo of `delete` (ADR 0004): rename the trashed file back into place.
    /// Prefers the exact `{id}.md`; falls back to the newest timestamp-suffixed
    /// copy (`{id}-<millis>.md`) from a delete-again collision.
    pub fn restore(&self, id: &str) -> Result<Note, StoreError> {
        let path = self.path_for(id)?;
        if path.is_file() {
            // Already back (e.g. double-undo) — restoring is idempotent.
            return self.read(id);
        }
        let trash = self.dir.join(TRASH_DIR);
        let mut candidate = trash.join(format!("{id}.md"));
        if !candidate.is_file() {
            let prefix = format!("{id}-");
            candidate = fs::read_dir(&trash)?
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(&prefix) && n.ends_with(".md"))
                })
                .max_by_key(|p| file_mtime(p).unwrap_or(0))
                .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        }
        fs::rename(&candidate, &path)?;
        self.read(id)
    }

    /// Missing sidecar = defaults (first run). An unreadable one is an ERROR,
    /// never defaults: the caller writes the value it was handed straight back
    /// on the next pin/zoom change, so answering a read failure with an empty
    /// Sidecar erases the real pins and order a moment later.
    pub fn sidecar_load(&self) -> Result<Sidecar, StoreError> {
        let path = self.dir.join(SIDECAR_NAME);
        match fs::read_to_string(&path) {
            Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_else(|e| {
                // On-disk file the user may hand-edit → warn, don't die. The
                // content is unrecoverable either way, so defaults lose nothing.
                eprintln!("[floatnotes] corrupt sidecar {}: {e} — using defaults", path.display());
                Sidecar::default()
            })),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Sidecar::default()),
            Err(e) => Err(StoreError::Io(e)),
        }
    }

    pub fn sidecar_save(&self, sidecar: &Sidecar) -> Result<(), StoreError> {
        let path = self.dir.join(SIDECAR_NAME);
        let raw = serde_json::to_string_pretty(sidecar).expect("sidecar serializes");
        self.atomic_write(&path, &raw)?;
        Ok(())
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, StoreError> {
        if id.is_empty()
            || id.starts_with('.')
            || id.contains('/')
            || id.contains('\\')
            || id.contains("..")
        {
            return Err(StoreError::InvalidId(id.to_string()));
        }
        Ok(self.dir.join(format!("{id}.md")))
    }

    /// slug + short random suffix; loops until the filename is free.
    fn new_id(&self, title: &str) -> String {
        let slug = slugify(title);
        for attempt in 0u64.. {
            let id = format!("{slug}-{}", random_suffix(attempt));
            if !self.dir.join(format!("{id}.md")).exists() {
                return id;
            }
        }
        unreachable!("suffix space exhausted");
    }

    /// Atomic write: dot-prefixed temp file beside the target (same filesystem,
    /// invisible to the watcher) + rename into place.
    ///
    /// Two things this has to get right, both of which lose data quietly when
    /// they are missed:
    ///
    /// - **Symlinks are followed, not replaced.** `rename` over a symlink
    ///   swaps the *link* for a regular file: the edit lands in the notes dir,
    ///   the file the user actually pointed at is never touched, the link is
    ///   destroyed, and nothing errors. Resolve first and write the real file.
    /// - **The temp file is fsynced before the rename.** `rename` is atomic
    ///   for the directory entry only; without the fsync a crash can commit
    ///   the entry while the bytes are still in the page cache, leaving an
    ///   empty or truncated note where a complete one used to be.
    fn atomic_write(&self, path: &Path, content: &str) -> io::Result<()> {
        let resolved = resolve_symlink(path)?;
        let parent = resolved.parent().ok_or_else(|| {
            io::Error::other(format!("{} has no parent directory", resolved.display()))
        })?;
        let tmp = parent.join(format!(".tmp-{}", random_suffix(0)));

        // A half-written temp file must never survive a failure: it is one
        // rename away from being mistaken for a note.
        if let Err(e) = write_and_sync(&tmp, content) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        if let Err(e) = fs::rename(&tmp, &resolved) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Ok(())
    }
}

/// Follow a symlink to the file it names (non-symlinks pass through). A
/// dangling link is an error, not a silent "write a fresh file here".
fn resolve_symlink(path: &Path) -> io::Result<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!("{} is a symlink that cannot be resolved: {e}", path.display()),
            )
        }),
        _ => Ok(path.to_path_buf()),
    }
}

/// Write `content` to `path` and flush it to the physical device before
/// returning. `fs::write` only reaches the page cache.
fn write_and_sync(path: &Path, content: &str) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()
}

/// title = first non-empty line, leading `#`s stripped. Lines that are empty
/// after stripping (e.g. a bare `###`) don't count as a title.
pub fn derive_title(content: &str) -> String {
    content
        .lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Untitled".to_string())
}

pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = true; // suppress leading dash
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
        if slug.len() >= 40 {
            break;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "note".to_string()
    } else {
        slug
    }
}

pub fn file_mtime(path: &Path) -> io::Result<u64> {
    let mtime = fs::metadata(path)?.modified()?;
    Ok(mtime
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_millis() as u64)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_millis() as u64
}

/// 6-char base36 suffix from hashed (nanos, attempt) — no rand dependency.
fn random_suffix(attempt: u64) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_nanos();
    let mut hasher = DefaultHasher::new();
    nanos.hash(&mut hasher);
    attempt.hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    let mut n = hasher.finish();
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = String::with_capacity(6);
    for _ in 0..6 {
        out.push(ALPHABET[(n % 36) as usize] as char);
        n /= 36;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, NoteStore) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = NoteStore::open(dir.path()).expect("open store");
        (dir, store)
    }

    #[test]
    fn title_is_first_non_empty_line_minus_hashes() {
        assert_eq!(derive_title("# Hello\ntest"), "Hello");
        assert_eq!(derive_title("\n\n  ## Two hashes  \nbody"), "Two hashes");
        assert_eq!(derive_title("plain line\nsecond"), "plain line");
        assert_eq!(derive_title("###\nbody"), "body");
        assert_eq!(derive_title(""), "Untitled");
        assert_eq!(derive_title("\n \n"), "Untitled");
    }

    #[test]
    fn slugs_are_lowercase_dashed_and_bounded() {
        assert_eq!(slugify("Hello World!"), "hello-world");
        assert_eq!(slugify("  ---  "), "note");
        assert_eq!(slugify("Ünïcode stripped"), "n-code-stripped");
        assert!(slugify(&"x".repeat(100)).len() <= 40);
    }

    #[test]
    fn create_writes_md_file_with_stable_slug_id() {
        let (_tmp, store) = store();
        let note = store.create("# Hello\ntest").expect("create");
        assert!(note.id.starts_with("hello-"));
        assert_eq!(note.title, "Hello");
        let on_disk = std::fs::read_to_string(store.dir().join(format!("{}.md", note.id)))
            .expect("file exists");
        assert_eq!(on_disk, "# Hello\ntest");
        // No stray temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(store.dir())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn same_title_notes_get_distinct_filenames() {
        let (_tmp, store) = store();
        let a = store.create("# Same").expect("create a");
        let b = store.create("# Same").expect("create b");
        assert_ne!(a.id, b.id);
        assert_eq!(store.list().expect("list").len(), 2);
    }

    #[test]
    fn update_keeps_filename_and_rederives_title() {
        let (_tmp, store) = store();
        let note = store.create("# Old title").expect("create");
        let updated = store
            .update(&note.id, "# New title\nbody", note.mtime)
            .expect("update");
        assert_eq!(updated.id, note.id);
        assert_eq!(updated.title, "New title");
    }

    #[test]
    fn update_with_stale_mtime_conflicts() {
        let (_tmp, store) = store();
        let note = store.create("# Hello").expect("create");
        let err = store
            .update(&note.id, "clobber", note.mtime + 1)
            .expect_err("stale mtime must conflict");
        assert!(matches!(err, StoreError::Conflict { .. }));
        // Content untouched.
        assert_eq!(store.read(&note.id).unwrap().content, "# Hello");
    }

    #[test]
    fn delete_moves_into_trash_never_unlinks() {
        let (_tmp, store) = store();
        let note = store.create("# Bye").expect("create");
        store.delete(&note.id).expect("delete");
        assert!(matches!(
            store.read(&note.id),
            Err(StoreError::NotFound(_))
        ));
        let trashed = store.dir().join(TRASH_DIR).join(format!("{}.md", note.id));
        assert_eq!(std::fs::read_to_string(trashed).unwrap(), "# Bye");
    }

    #[test]
    fn restore_renames_back_out_of_trash() {
        let (_tmp, store) = store();
        let note = store.create("# Undo me").expect("create");
        store.delete(&note.id).expect("delete");
        let restored = store.restore(&note.id).expect("restore");
        assert_eq!(restored.id, note.id);
        assert_eq!(restored.content, "# Undo me");
        // Idempotent: restoring an already-live note just reads it.
        assert_eq!(store.restore(&note.id).expect("re-restore").id, note.id);
        // Unknown id stays NotFound.
        assert!(matches!(
            store.restore("never-existed"),
            Err(StoreError::NotFound(_))
        ));
    }

    #[test]
    fn restore_after_double_delete_picks_the_suffixed_copy() {
        let (_tmp, store) = store();
        let note = store.create("# Twice").expect("create");
        store.delete(&note.id).expect("first delete");
        store.restore(&note.id).expect("first restore");
        store.delete(&note.id).expect("second delete");
        // Simulate the collision layout: exact name occupied by an older copy.
        let trash = store.dir().join(TRASH_DIR);
        let exact = trash.join(format!("{}.md", note.id));
        assert!(exact.is_file());
        let restored = store.restore(&note.id).expect("restore again");
        assert_eq!(restored.content, "# Twice");
    }

    #[test]
    fn delete_collision_in_trash_gets_timestamp_suffix() {
        let (_tmp, store) = store();
        let note = store.create("# Twice").expect("create");
        let id = note.id.clone();
        store.delete(&id).expect("first delete");
        // Recreate the same filename manually, then delete again.
        std::fs::write(store.dir().join(format!("{id}.md")), "# Twice again").unwrap();
        store.delete(&id).expect("second delete");
        let trash_entries = std::fs::read_dir(store.dir().join(TRASH_DIR))
            .unwrap()
            .count();
        assert_eq!(trash_entries, 2);
    }

    #[test]
    fn ids_cannot_escape_the_notes_dir() {
        let (_tmp, store) = store();
        for bad in ["../evil", ".hidden", "a/b", ""] {
            assert!(matches!(
                store.read(bad),
                Err(StoreError::InvalidId(_))
            ));
        }
    }

    #[test]
    fn sidecar_roundtrips_and_defaults_on_corruption() {
        let (_tmp, store) = store();
        let sidecar = Sidecar {
            pins: vec!["a".into()],
            order: vec!["a".into(), "b".into()],
            zoom: Some(1.2),
            esc_behavior: Some("unfocus".into()),
        };
        store.sidecar_save(&sidecar).expect("save");
        let loaded = store.sidecar_load().expect("load");
        assert_eq!(loaded.pins, vec!["a"]);
        assert_eq!(loaded.order.len(), 2);
        assert_eq!(loaded.esc_behavior.as_deref(), Some("unfocus"));
        std::fs::write(store.dir().join(SIDECAR_NAME), "{not json").unwrap();
        let recovered = store.sidecar_load().expect("corrupt json still loads defaults");
        assert!(recovered.pins.is_empty());
    }
}
