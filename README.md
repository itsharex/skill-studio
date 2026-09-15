# Skill Studio

跨 agent 的 Agent Skill 管理器。扫描本机 AI coding agent 的全局 skill，用**符号链接或文件复制**
注册到其他 agent；把 skill 编排成**分组**后一键整组应用；给单个**项目**绑定只对它生效的 skill。

技术栈与 UI 全面对齐 [cc-switch](https://github.com/farion1231/cc-switch)：Tauri 2 + React 18 +
Tailwind v3 + shadcn/Radix，后端 Rust。

---

## 为什么做

cc-switch 内部其实已经带了一个 skill 管理器，但它围绕「从 GitHub 装 skill → 同步到各 agent
全局目录」这条主线。对照实际需求，缺口是：

| 需求 | cc-switch | Skill Studio |
|---|---|---|
| 检测本机 agent 全局 skill，注册到其他 agent | 已有（以自己的 SSOT 目录为中心） | 支持**原地互链**，不强制搬动文件 |
| 全局 skill 分组，按组批量应用 | 无 | ✅ |
| 项目级 skill，只对该项目生效 | 无 | ✅ |

---

## 功能

**跨 agent 注册**
- 扫描各 agent 的全部全局 skill 根目录，识别真身、软链、本工具的副本、以及用户手工放的内容
- 三种链接方式：`auto`（优先软链，失败自动回退复制）/ `symlink` / `copy`
- 7 态状态模型，每个 agent 一个状态点，hover 出实际路径

| 状态 | 含义 |
|---|---|
| `source` | 真身就在这个 agent 的目录里 |
| `linked` | 软链指向真身，改真身即刻生效 |
| `copied` | 副本与真身一致 |
| `copyStale` | 真身已变更，副本是旧的 |
| `foreign` | 该位置已有**非本工具管理**的内容，**绝不覆盖** |
| `brokenLink` | 软链悬空 |
| `conflict` | 链接指向了别处 |

**分组（一次性 Add / Remove）**
- 点一下把组内 skill 批量注册或批量移除，**组外的一律不动**，不做持续对账
- 因此永远不会误删你手动添加的 skill
- 成员可拖拽排序，一个 skill 可属于多个分组

**项目级 skill**
- 绑定项目目录 → 勾选 agent → 绑 skill 或整个分组 → 写入
- **默认用复制而不是软链**：项目 skill 通常要进 git 给团队共享，而软链进 git 只是一个指向本机
  绝对路径的文本文件，别人拉下来就是断链
- 一键把 `.skill-studio-copy.json` 写进项目 `.gitignore`

**三态启停（用官方机制，不删文件）**
- Claude Code → `settings.json` 的 `skillOverrides`
- Codex → `config.toml` 的 `[[skills.config]]`
- 瞬时、无损、可逆，且你在 agent 里 `/skills` 看到的状态与 Studio 一致

**其他**
- **Hub 模式**：把原地 skill 收编到 `~/.skill-studio/skills` 集中托管，原位置自动改成链接
- **跨端 frontmatter 提示**：Claude Code 专有字段（`context` / `agent` / `model` / `effort` / `hooks` / `paths` 等）
  在 Codex 上会被忽略、上传 claude.ai 会直接报错，界面上标出来
- **文件监听**：你在 Studio 之外改动 skill 目录，界面自动刷新
- 配置原子写入 + 备份轮转 + 一键恢复

---

## 支持的 agent

第一版覆盖两个，注册表是数据驱动的静态表，加一个 agent 只是加一条配置。

| Agent | 全局 skill 目录 | 项目 skill 目录 | 目录覆盖变量 | 启停机制 |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills` | `.claude/skills` | `CLAUDE_CONFIG_DIR` | `settings.json` → `skillOverrides` |
| Codex | `~/.codex/skills` **和** `~/.agents/skills` | `.agents/skills` | `CODEX_HOME` | `config.toml` → `[[skills.config]]` |

几条容易搞错、已逐条核实过的事实：

- **Codex 的 User scope 有两个根**：`$CODEX_HOME/skills` 和 `~/.agents/skills`。后者是中立共享根，
  不随 `CODEX_HOME` 移动。依据是源码 `codex-rs/ext/skills/src/host_roots.rs` 里的
  `AGENTS_DIR_NAME = ".agents"`。只认前者会漏扫。
- **Codex 的项目级目录是 `.agents/skills`，不是 `.codex/skills`**。
- Claude Code 的 `synced`（任意大小写）是 claude.ai 同步专用保留名，扫描必须跳过。
- 两个 agent 都明确支持并跟随符号链接。
- 目录解析优先级：**Studio 里的显式设置 > 环境变量 > 默认位置**。环境变量常写在 shell profile 里，
  图形界面进程未必继承得到，所以给了显式设置一条更高的优先级。

---

## 安装与运行

需要 Node 22.12+、pnpm 10.12.3、Rust 1.85+。

```sh
pnpm install
pnpm dev          # 开发模式
pnpm build        # 打包桌面应用
```

> **本机注意**：`~/.local/bin/pnpm` 是个指向 `/opt/homebrew/bin/corepack` 的包装脚本，而该文件
> 已不存在（大概是 homebrew 升级 node 时移除了 corepack），直接跑 `pnpm` 会报 `cannot execute`。
> 修法：`brew install corepack` 或 `npm i -g pnpm@10.12.3`。在修好之前，所有命令都可以用
> `npx --yes pnpm@10.12.3 <cmd>` 代替。

---

## 项目结构

```
crates/core/          纯 Rust 核心，零 Tauri 依赖
├── fs/paths.rs       路径解析与比较（含 is_same_path / paths_overlap）
├── fs/atomic.rs      原子写入
└── services/
    ├── detector.rs   agent 探测（目录 + CLI 三态）
    ├── scanner.rs    目录扫描、frontmatter 解析、内容哈希
    ├── linker.rs     ★ 链接引擎
    ├── native_toggle.rs  写 agent 原生配置做启停
    ├── store.rs      配置读写 + 备份轮转
    └── studio.rs     编排层
src-tauri/            薄 Tauri 层，33 个命令一对一转发到 core
src/                  前端（Vite root 指向这里）
├── lib/api/          invoke 的薄封装
├── hooks/useData.ts  TanStack Query（唯一状态容器，无 zustand）
└── pages/            5 个页面
tests/                前端测试
```

核心逻辑放独立 crate，`cargo test -p skill-studio-core` 不需要起 GUI，跑完全部 120 个测试约 0.6 秒。

---

## 命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动应用 |
| `pnpm dev:renderer` | 只起前端，浏览器里看 UI（Tauri API 会静默失败） |
| `pnpm build` | 打包 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `format:check` | Prettier（无配置文件，全默认） |
| `pnpm test:unit` | Vitest |
| `cargo test --workspace` | Rust 测试（105 单测 + 15 集成） |
| `cargo clippy --workspace --all-targets -- -D warnings` | 零警告门禁 |
| `cargo fmt --all` | 格式化 |

---

## 安全不变式

这几条是链接引擎的底线，每条都有对应的回归测试：

1. **源必须含 `SKILL.md` 才允许替换目标** —— 否则一个空目录会把你 agent 里的真 skill 抹掉
2. **`Foreign` 绝不覆盖** —— 目标位置有非本工具管理的内容时拒绝操作，除非显式 force
3. **真身永不被当作注册删掉** —— 取消注册只动链接与副本
4. **Hub 目录不能与任何 agent 的 skills 目录重叠** —— 否则同步会自己吃自己
5. **目录级替换走 tmp + rename** —— 任何失败都清理临时目录，不留半个 skill
6. **配置解析失败不静默回落默认值** —— 那会让你攒的分组凭空消失；直接报错并引导去 `backups/`

---

## 从 cc-switch 移植时修掉的几个问题

- `atomic_write` 缺 `file.sync_all()` 与父目录 fsync：断电时 rename 可能先于数据落盘
- 没装 `tailwindcss-animate`，导致 11 处 `animate-in` / `zoom-in` 类静默失效
- `settings.json` 的写入没走原子写（与其他配置写入不一致）
- `is_symlink()` 认不出 Windows 上 `mklink /J` 建的 junction
- Codex 只映射了 `~/.codex/skills`，漏掉 `~/.agents/skills`

---

## 已知环境坑

- **`strip = "symbols"` 不能用**（macOS）：它会把 proc-macro 的 `.dylib` 一起剥掉符号，产出
  `mis-aligned LINKEDIT string pool`，dyld 加载失败，表现为编译期 `can't find crate for xxx_derive`。
  已改为 `strip = "debuginfo"`。debug 构建不受影响，所以这个问题只在 release 构建暴露。
- **Node 26 自带实验性 `localStorage` 全局**，但没有 `--localstorage-file` 时不可用。jsdom 也不把
  `localStorage` 暴露成裸全局，所以 `tests/setupGlobals.ts` 里自带内存 polyfill，删掉测试就挂。
- **Radix 浮层在 jsdom + Node 26 下单次打开要数秒**（根因是 jsdom 的 `getComputedStyle` 性能），
  因此 vitest 的 `testTimeout` 提到了 20 秒。这是测试环境特性，不影响实际应用。
- `tauri-plugin-window-state` 会记住窗口位置，`tauri.conf.json` 里的 `center: true` 从第二次启动起
  不再生效，这是预期行为。

---

## 当前状态

三条需求已全部端到端可用，本地门禁全绿：

| 检查 | 结果 |
|---|---|
| `cargo test --workspace` | 105 单测 + 15 集成测试 |
| `cargo clippy -- -D warnings` | 零警告 |
| `cargo fmt --check` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test:unit` | 23 个用例（含 6 项前后端 IPC 契约检查） |
| `pnpm build` | 产出 macOS `.dmg` / `.app` |

**GitHub Actions 目前跑不起来**：账号的 Actions 额度或付款有问题，所有 job 都以
"recent account payments have failed or your spending limit needs to be increased" 失败。
workflow 文件本身是好的，需要去 GitHub 的 Billing & plans 处理，或把仓库设为 public
（public 仓库的 Actions 分钟数免费）。

**尚未做**：i18n（界面目前是中文硬编码，结构已留好但没抽字符串）、从 GitHub 直接装 skill
（cc-switch 已有这块，需要时再移植）、更多 agent。
