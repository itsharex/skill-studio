//! Write-ahead undo journal for filesystem replacements. Backups stay beside each
//! target so rename never crosses filesystems. Recovery runs before loading config.
use super::scanner::is_symlink_or_junction;
use crate::{
    error::{Error, Result},
    fs::{atomic, paths},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
struct Entry {
    target: PathBuf,
    backup: PathBuf,
    existed: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Transaction {
    journal: PathBuf,
    entries: Vec<Entry>,
    committed: bool,
    #[serde(skip)]
    _lock: Option<fs::File>,
}

pub fn remove(path: &Path) -> Result<()> {
    if is_symlink_or_junction(path) {
        super::linker::remove_symlink_or_junction(path).map_err(|e| Error::io(path, e))
    } else {
        match fs::symlink_metadata(path) {
            Ok(m) if m.is_dir() => fs::remove_dir_all(path).map_err(|e| Error::io(path, e)),
            Ok(_) => fs::remove_file(path).map_err(|e| Error::io(path, e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::io(path, e)),
        }
    }
}

pub fn sibling(path: &Path, label: &str) -> PathBuf {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_file_name(format!(
        ".{}.{}-{}-{nonce}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        label,
        std::process::id()
    ))
}

/// Whether `path` sits directly inside `dir`.
///
/// `..` is refused outright rather than normalized: `normalize_path_lexically`
/// resolves it without consulting the filesystem, so a symlinked component makes the
/// lexical answer disagree with the real one.
fn is_direct_child(path: &Path, dir: &Path) -> bool {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    path.parent()
        .is_some_and(|parent| paths::is_same_path(parent, dir))
}

// The lock file is intentionally retained: unlinking it would allow two
// processes to lock different inodes while recovering the same journal.
fn lock_journal(journal: &Path) -> Result<fs::File> {
    if let Some(parent) = journal.parent() {
        fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    }
    let lock_path = journal.with_extension("json.lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| Error::io(&lock_path, e))?;
    fs2::FileExt::try_lock_exclusive(&file)
        .map_err(|e| Error::io_context("另一个进程正在修改此目录，请稍后重试", e))?;
    Ok(file)
}

impl Transaction {
    pub fn begin(journal: PathBuf) -> Result<Self> {
        let lock = lock_journal(&journal)?;
        if journal.try_exists().map_err(|e| Error::io(&journal, e))? {
            return Err(Error::invalid("存在待恢复的文件事务，请重启应用后重试"));
        }
        let tx = Self {
            journal,
            entries: vec![],
            committed: false,
            _lock: Some(lock),
        };
        tx.persist()?;
        Ok(tx)
    }
    fn persist(&self) -> Result<()> {
        atomic::write_json_file(&self.journal, self)
    }
    /// Reserve a path before changing it; an existing object is moved intact.
    pub fn reserve(&mut self, target: &Path) -> Result<()> {
        let existed = match fs::symlink_metadata(target) {
            Ok(_) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(Error::io(target, e)),
        };
        let backup = sibling(target, "backup");
        self.entries.push(Entry {
            target: target.to_owned(),
            backup: backup.clone(),
            existed,
        });
        self.persist()?;
        if existed {
            fs::rename(target, &backup).map_err(|e| Error::io(target, e))?;
        }
        Ok(())
    }
    pub fn commit(mut self) -> Result<()> {
        self.committed = true;
        if let Err(err) = self.persist() {
            self.committed = false;
            self.finish()?;
            return Err(err);
        }
        // A committed journal is safe to clean again at the next startup.
        if let Err(e) = self.finish() {
            log::warn!("事务已提交，清理将在启动时重试: {e}");
        }
        Ok(())
    }
    pub fn rollback(self) -> Result<()> {
        self.finish()
    }
    /// The first target or backup that reaches outside `dir`, if any.
    fn escaping_entry(&self, dir: &Path) -> Option<&Path> {
        self.entries
            .iter()
            .flat_map(|e| [e.target.as_path(), e.backup.as_path()])
            .find(|p| !is_direct_child(p, dir))
    }
    fn finish(&self) -> Result<()> {
        for entry in self.entries.iter().rev() {
            if self.committed {
                remove(&entry.backup)?;
            } else if entry.existed {
                match fs::symlink_metadata(&entry.backup) {
                    Ok(_) => {
                        remove(&entry.target)?;
                        fs::rename(&entry.backup, &entry.target)
                            .map_err(|e| Error::io(&entry.target, e))?;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(Error::io(&entry.backup, e)),
                }
            } else {
                remove(&entry.target)?;
            }
        }
        fs::remove_file(&self.journal).map_err(|e| Error::io(&self.journal, e))
    }
}

pub fn recover(journal: &Path) -> Result<()> {
    if !journal.try_exists().map_err(|e| Error::io(journal, e))? {
        return Ok(());
    }
    let _lock = lock_journal(journal)?;
    if let Some(tx) = atomic::read_json_file::<Transaction>(journal)? {
        tx.finish()?;
    }
    Ok(())
}

/// Recover a journal that was found by scanning a directory the app does not own.
///
/// `recover` executes absolute paths taken from the journal's *contents*. That is
/// sound for the store's own journals, which are opened by fixed path, but
/// `.skill-studio-replace-*.json` files are different: they live inside user project
/// trees and are gitignored rather than hidden, so they travel with a clone and their
/// contents are untrusted input. A replacement journal only ever reserves `dest` plus
/// its staging and backup siblings, so every path it carries must sit directly in the
/// journal's own directory — which is taken from `journal`, not from the deserialized
/// `journal` field, since that field is untrusted too.
///
/// A journal reaching past that is reported and left on disk rather than executed,
/// and deliberately does not become an `Err`: `load_config` propagates one, so
/// erroring here would trade arbitrary deletion for an app that cannot start.
pub fn recover_confined(journal: &Path) -> Result<()> {
    if !journal.try_exists().map_err(|e| Error::io(journal, e))? {
        return Ok(());
    }
    let Some(dir) = journal.parent() else {
        return Ok(());
    };
    let _lock = lock_journal(journal)?;
    let Some(tx) = atomic::read_json_file::<Transaction>(journal)? else {
        return Ok(());
    };
    if let Some(escaping) = tx.escaping_entry(dir) {
        log::warn!(
            "忽略 {}：条目 {} 越出所在目录，不执行恢复",
            journal.display(),
            escaping.display()
        );
        return Ok(());
    }
    tx.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_rolls_back_files_and_configuration_together() {
        let tmp = tempfile::tempdir().unwrap();
        let journal = tmp.path().join("migration.json");
        let source = tmp.path().join("source");
        let config = tmp.path().join("config.json");
        let hub = tmp.path().join("hub");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("SKILL.md"), "original").unwrap();
        fs::write(&config, "old config").unwrap();
        let mut tx = Transaction::begin(journal.clone()).unwrap();
        tx.reserve(&hub).unwrap();
        fs::create_dir(&hub).unwrap();
        tx.reserve(&source).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("SKILL.md"), "replacement").unwrap();
        tx.reserve(&config).unwrap();
        fs::write(&config, "new config").unwrap();
        drop(tx); // Simulate process termination before the commit marker.
        recover(&journal).unwrap();
        recover(&journal).unwrap(); // recovery is idempotent
        assert_eq!(
            fs::read_to_string(source.join("SKILL.md")).unwrap(),
            "original"
        );
        assert_eq!(fs::read_to_string(&config).unwrap(), "old config");
        assert!(!hub.exists());
    }
    #[test]
    fn recovery_after_commit_keeps_new_content() {
        let tmp = tempfile::tempdir().unwrap();
        let journal = tmp.path().join("migration.json");
        let target = tmp.path().join("file");
        fs::write(&target, "old").unwrap();
        let mut tx = Transaction::begin(journal.clone()).unwrap();
        tx.reserve(&target).unwrap();
        fs::write(&target, "new").unwrap();
        tx.committed = true;
        tx.persist().unwrap();
        drop(tx);
        recover(&journal).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 2);
    }
    /// A replacement journal travels with a cloned repo, so its contents are
    /// untrusted: an entry pointing outside the journal's own directory must be
    /// refused, and refusing it must not take startup down with it.
    #[test]
    fn confined_recovery_refuses_entries_reaching_outside_the_journal_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let scanned = tmp.path().join("repo/.claude/skills");
        let outside = tmp.path().join("precious");
        fs::create_dir_all(&scanned).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep.txt"), "mine").unwrap();
        let journal = scanned.join(".skill-studio-replace-demo.json");
        for target in [outside.clone(), scanned.join("..").join("escape")] {
            fs::write(
                &journal,
                serde_json::to_vec(&serde_json::json!({
                    "journal": journal,
                    "committed": false,
                    "entries": [{
                        "target": target,
                        "backup": tmp.path().join("nowhere"),
                        "existed": false,
                    }],
                }))
                .unwrap(),
            )
            .unwrap();
            recover_confined(&journal).unwrap();
            assert!(journal.is_file(), "越界的日志应原样保留，不静默删除");
        }
        assert!(outside.join("keep.txt").is_file());
    }

    /// The confinement check must not break the case it guards: an in-bounds
    /// replacement journal still has to roll back. This path had no coverage at all.
    #[test]
    fn confined_recovery_still_rolls_back_an_in_bounds_journal() {
        let tmp = tempfile::tempdir().unwrap();
        let scanned = tmp.path().join("repo/.claude/skills");
        fs::create_dir_all(&scanned).unwrap();
        let dest = scanned.join("demo");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("SKILL.md"), "original").unwrap();
        let journal = scanned.join(".skill-studio-replace-demo.json");
        let mut tx = Transaction::begin(journal.clone()).unwrap();
        tx.reserve(&dest).unwrap();
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("SKILL.md"), "replacement").unwrap();
        drop(tx); // Terminated before the commit marker.
        recover_confined(&journal).unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "original"
        );
        assert!(!journal.exists());
    }

    #[test]
    fn failed_install_restores_original_target() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("file");
        fs::write(&target, "old").unwrap();
        let mut tx = Transaction::begin(tmp.path().join("journal.json")).unwrap();
        tx.reserve(&target).unwrap();
        assert!(fs::rename(tmp.path().join("missing-stage"), &target).is_err());
        tx.rollback().unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), "old");
    }
}

#[cfg(test)]
mod locking_tests {
    use super::*;
    #[test]
    fn recovery_cannot_undo_another_live_transaction() {
        let dir = tempfile::tempdir().unwrap();
        let journal = dir.path().join("migration.json");
        let tx = Transaction::begin(journal.clone()).unwrap();
        assert!(recover(&journal).is_err());
        assert!(Transaction::begin(journal.clone()).is_err());
        drop(tx);
        recover(&journal).unwrap();
    }
}
