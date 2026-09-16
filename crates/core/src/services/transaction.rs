//! Write-ahead undo journal for filesystem replacements. Backups stay beside each
//! target so rename never crosses filesystems. Recovery runs before loading config.
use super::scanner::is_symlink_or_junction;
use crate::{
    error::{Error, Result},
    fs::atomic,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
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
