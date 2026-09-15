//! 监听各 agent 的 skills 目录，用户在 Studio 之外改动时通知前端刷新。
//!
//! cc-switch 没有这块（它靠用户点刷新）。这里补上，但刻意保守：
//! - **不递归**：只看目录项的增删改名。递归进 symlink 在各平台语义不一致，
//!   而且 skill 内部文件的改动由内容哈希在扫描时判定，不需要实时。
//! - **去抖**：一次批量操作会触发几十个事件，聚合成一次前端刷新。

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 前端监听的事件名
pub const SKILLS_CHANGED_EVENT: &str = "skills-changed";

/// 去抖窗口。批量注册会在短时间内产生大量事件。
const DEBOUNCE: Duration = Duration::from_millis(400);

/// 起一个后台线程监听给定目录。返回 watcher，调用方需持有它 —— drop 掉就停止监听。
pub fn spawn(app: AppHandle, dirs: Vec<PathBuf>) -> Option<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |res| {
        // 发送失败说明接收端已退出，忽略即可
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            log::warn!("创建文件监听器失败，将退化为手动刷新: {e}");
            return None;
        }
    };

    let mut watched = 0usize;
    for dir in &dirs {
        // 目录可能还不存在（用户没装那个 agent），静默跳过
        if !dir.is_dir() {
            continue;
        }
        match watcher.watch(dir, RecursiveMode::NonRecursive) {
            Ok(()) => watched += 1,
            Err(e) => log::debug!("监听 {} 失败: {e}", dir.display()),
        }
    }
    if watched == 0 {
        log::info!("没有可监听的 skills 目录，跳过文件监听");
        return None;
    }
    log::info!("已监听 {watched} 个 skills 目录");

    std::thread::spawn(move || {
        let mut pending_since: Option<Instant> = None;
        loop {
            // 有待发事件时用短超时轮询，以便到点就发；否则长时间阻塞等事件
            let timeout = if pending_since.is_some() {
                DEBOUNCE
            } else {
                Duration::from_secs(3600)
            };
            match rx.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    if is_interesting(&event) {
                        pending_since.get_or_insert_with(Instant::now);
                    }
                }
                Ok(Err(e)) => log::debug!("文件监听事件错误: {e}"),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                // 发送端已 drop，watcher 被回收，退出线程
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if let Some(since) = pending_since {
                if since.elapsed() >= DEBOUNCE {
                    pending_since = None;
                    if let Err(e) = app.emit(SKILLS_CHANGED_EVENT, ()) {
                        log::debug!("推送 {SKILLS_CHANGED_EVENT} 失败: {e}");
                    }
                }
            }
        }
        log::debug!("文件监听线程退出");
    });

    Some(watcher)
}

/// 只关心目录项的增删与改名；内容改动交给扫描时的哈希判定。
fn is_interesting(event: &notify::Event) -> bool {
    use notify::EventKind;
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    )
}
