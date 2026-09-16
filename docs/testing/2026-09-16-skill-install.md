# skills.sh 安装验证（2026-09-16）

## 范围

Skill Hub 的新增入口进入独立安装页；skills.sh 搜索、结果卡片、查看来源、
安装完整 skill 目录、持久化仓库记录，以及 Hub 的 Skill Studio 来源计数和图标。
安装只写入 Hub，不自动注册到 Agent。

参考：CC Switch 的 skills.sh 搜索和仓库 skill 定位流程：
https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/skill.rs

## 已执行

- cargo test --workspace：167 项通过；网络用例默认忽略。
- 显式执行 marketplace 的 live_search_download_and_install_in_temporary_home：
  使用真实 skills.sh 搜索 defuddle，下载 kepano/obsidian-skills 仓库，
  解析目录并安装到隔离临时 HOME。验证 SKILL.md、配置重载后的 studio 来源、
  没有 Agent 注册记录。通过。
- pnpm test:unit：61 项通过。新增安装交互、失败重试、空结果、
  安装后 Studio 图标/计数和重复安装禁用验证；更新 Hub 加号导航断言。
- pnpm typecheck：通过。
- cargo clippy --workspace --all-targets -- -D warnings：通过。
- pnpm build:renderer、cargo build -p skill-studio：通过。
  前端构建保留已有的 bundle 大小提示。
- git diff --check：通过。

确定性后端用例覆盖完整目录资源复制、同名不覆盖、重复安装幂等、
路径穿越/无效 ZIP/歧义目标/错误 YAML 拒绝，以及配置重载后来源不变。
所有安装测试都在临时目录运行，没有修改本机已有的语雀 skill。
前端交互通过 mocked IPC 测试，不代表原生窗口的人工点击测试。

## 当前边界

搜索至少 2 个字符，最多显示 100 条。安装下载 GitHub 默认分支的归档，
有下载大小、解压大小和文件数量限制。含符号链接的仓库会明确拒绝自动安装。
记录仓库、skill 标识、仓库内目录、安装时间及内容哈希。
网络错误和同名冲突展示错误，可重试，不覆盖已有 skill。

## 本地导入补充

- 安装页在 skills.sh 左侧提供“本地”页签。支持系统目录选择器和手工输入路径，
  可扫描单个 skill 目录或多 skill 集合，逐项导入。
- 使用现有 Hub 目录，默认 ~/.skill-studio/skills；本机没有配置目录覆盖。
- 导入复制完整内容，保留原文件；来源为 studio，安装记录以 local:绝对路径
  保存导入位置。计数和图标复用现有 Studio 来源逻辑。
- 新增后端用例：嵌套集合发现、隐藏目录忽略、资源复制、原文件哈希不变、
  来源持久化、重复导入、同名冲突、无效 YAML 和符号链接拒绝。
- 新增前端用例：切换本地页签、扫描集合、导入后状态刷新、空目录和错误提示。
- 未直接导入用户的 personal-agent-skills；测试使用隔离临时目录。
- 补充后完整验证：169 项 Rust 测试、63 项前端测试通过；TypeScript、Clippy、
  前端构建和 debug 构建通过。debug 应用运行中。
