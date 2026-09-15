# Skill Studio

跨 agent 的 Agent Skill 管理器：扫描本机 AI coding agent 的全局 skill，用符号链接或文件复制
注册到其他 agent；支持把 skill 分组后按组批量应用；支持只对单个项目生效的项目级 skill。

技术栈与 UI 全面对齐 [cc-switch](https://github.com/farion1231/cc-switch)。

## 当前进度

- [x] **1. 脚手架** — Vite + React 18 + Tailwind v3 + shadcn/Radix + Tauri 2；窗口壳、设计 token、主题切换、侧栏导航已就位并有测试覆盖
- [ ] 2. `crates/core` 骨架（路径工具 + 原子写 + agent 注册表）
- [ ] 3. detector + scanner
- [ ] 4. linker（软链 / 复制 / 状态检查）
- [ ] 5. store（配置原子读写 + 备份）
- [ ] 6. 需求 1：跨 agent 注册
- [ ] 7. 需求 2：分组
- [ ] 8. 需求 3：项目级 skill
- [ ] 9. 三态启停（Claude `skillOverrides` / Codex `config.toml`）
- [ ] 10. Hub 模式
- [ ] 11. 打磨（文件监听 / i18n / CI / 打包）

## 开发环境

需要 Node 22.12+、pnpm 10.12.3、Rust 1.85+。

> **本机注意**：`~/.local/bin/pnpm` 是个指向 `/opt/homebrew/bin/corepack` 的包装脚本，
> 而该文件已不存在（大概是 homebrew 升级 node 时移除了 corepack），所以 `pnpm` 直接跑会报
> `cannot execute`。两种修法：
>
> ```sh
> brew install corepack          # 恢复原有包装脚本
> # 或
> npm i -g pnpm@10.12.3          # 直接装独立版本
> ```
>
> 在修好之前，所有命令都可以用 `npx --yes pnpm@10.12.3 <cmd>` 代替。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装前端依赖 |
| `pnpm dev` | 启动应用（Tauri + Vite dev server，端口 3000） |
| `pnpm dev:renderer` | 只起前端，浏览器里看 UI（Tauri API 会静默失败） |
| `pnpm build` | 打包桌面应用 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` / `format:check` | Prettier（无配置文件，全用默认） |
| `pnpm test:unit` | Vitest |
| `cargo test -p skill-studio-core` | 核心逻辑单测，不需要起 GUI |
| `cargo clippy --workspace -- -D warnings` | Rust lint，零警告门禁 |
| `cargo fmt --all` | Rust 格式化 |

## 结构

```
crates/core/          纯 Rust 核心，零 Tauri 依赖：agent 注册表、扫描、链接引擎
src-tauri/            薄 Tauri 层，commands 一对一转发到 core
src/                  前端（Vite root 指向这里，index.html 也在这里）
  components/ui/      shadcn 原语
  lib/api/            Tauri invoke 的薄封装层
  lib/query/          TanStack Query（唯一的状态容器，无 zustand）
tests/                前端测试（与源码分离，MSW 拦截 invoke）
```

## 设计约定

- 语义色：**蓝** = 当前/主操作，**emerald** = 启用/开关 on，**红** = 删除，**amber** = 警告
- body 基准字号 `text-sm`（14px），容器圆角 `rounded-xl`，横向内边距统一 `px-6`
- 滚动条全局隐藏；毛玻璃用 `.glass` / `.glass-card`
- 主题走自写 `ThemeProvider`（localStorage `skill-studio-theme`），`<html>` 上 light/dark 都显式加类
- 改 `src/index.html` 里的内联主题脚本后，**必须同步更新 `tauri.conf.json` 的 CSP sha256**

## 图标

`app-icon.png`（1024×1024）是源图，改完后跑 `pnpm exec tauri icon app-icon.png` 重新生成全套。

## 已知环境坑

- **Node 26 自带实验性 `localStorage` 全局**，但没有 `--localstorage-file` 时不可用（会打
  `ExperimentalWarning` 且取值为 undefined）。jsdom 也不把 `localStorage` 暴露成裸全局，
  所以 `tests/setupGlobals.ts` 里自带了一个内存实现的 polyfill，删掉它测试就会挂。
- `tauri-plugin-window-state` 会记住窗口位置，`tauri.conf.json` 里的 `center: true` 从第二次
  启动起就不再生效，这是预期行为。
