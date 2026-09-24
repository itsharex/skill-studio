# 远程 MCP 只读展示验证 · 2026-09-24

## 实现范围

- SSH helper 新增 `scan_mcp`，复用本机五个 Agent 的原生配置解析及路径规则，扫描全局与已登记项目配置。
- 扫描入口直接只读解析 Studio 配置，绕过配置迁移、事务恢复与策略协调；可写 Skill 会话中的 MCP 扫描也走这条路径。远程 `mcp_request` 明确拒绝。
- 返回名称、稳定 ID、Agent 归属与文件读取警告，不返回原始连接定义、启动参数、环境变量、URL 或请求头，不读授权缓存或执行命令。
- 同一连接聚合来源，同名不同连接分别显示；禁用 Agent 的专属配置和标记隐藏，共享配置保留。沿用 Codex 内置服务展示偏好。
- MCP Hub 远程卡片仅显示名称及 Agent 图标／名称，无点击和管理操作。搜索和顶部重新扫描可用；远程 MCP 模式保留 Agent、项目导航和「+」按钮并置灰，切回 Skill Hub 后恢复可用。
- 查询按服务器分开；迟到结果不跨目标显示。断线不回退到本机，旧组件显示升级提示。

## 已通过的检查

- 前端全量：27 文件、217 测试通过；随后新增断线用例，远程 MCP 6 个用例再次通过。
- SSH helper 协议：6 个测试通过，包含两种会话模式下的五 Agent／项目扫描、目录覆盖、同名冲突、共享聚合、禁用来源、内置服务偏好与畸形配置。
- 用配置与事务文件的逐字节快照证明扫描没有写入；配置中的测试命令没有执行，私有测试值未出现在协议响应中。空 HOME 扫描不会创建 Studio 目录。
- MCP：41 单元测试与 10 集成测试通过；service：12 个测试通过。两个原有显式忽略用例未运行。
- TypeScript、前端格式、Rust 格式、Clippy（MCP／service／helper，warnings as errors）、diff 检查与 macOS Debug 构建通过。
- GUI 预览：用实际 `RemoteMcpPage` 组件及模拟 IPC 数据核对卡片、Agent 标记和搜索，没有管理按钮或可点击卡片。

## Linux 实机与原生 GUI 验证

用户授权后，在 Linux x86_64 服务器的 `/tmp/skill-studio-remote-mcp-yeiTHBaI` 独立目录构建。复用原有 Rust 1.98.1 工具链和公开离线依赖，构建临时 workspace 仅包含 helper 所需四个 crate；生成锁文件中的依赖版本及校验和与仓库逐项一致。

- Linux release helper 协议测试：6 项通过，包括五 Agent、目录覆盖、全局与项目配置、禁用来源、内置服务偏好、畸形文件、无配置写入及无进程启动。
- 新增显式忽略测试 `live_desktop_ssh_mcp_inventory_is_read_only`，本次通过实际桌面 SSH 后端单独运行通过，覆盖按哈希部署、握手能力、共享 MCP 聚合、拒绝网关操作、重复扫描、断线拒绝，以及 Claude/Codex 文件前后 SHA-256 一致。
- 原生 Debug GUI 使用本机 `target/remote-mcp-gui/home` 和远程 `/tmp/skill-studio-mcp-live-zti0luyn` 隔离目录。通过应用真实连接后展示共享卡片及 Claude Code／Codex 标记；加入 OpenCode／Pi／Grok 测试条目后显示四张卡片、五个 Agent 标记，重新扫描与按 Agent 搜索通过。
- GUI 确认卡片无托管、编辑、删除、授权或网关入口。测试完成后已退出隔离实例，并恢复使用用户正常本机配置的最新 Debug App。
- Linux helper SHA-256：`612bbdce688df9802b647538896321d657ce8cbf41db60a6e3758d8ed53b1bf9`。已更新本地 x86_64 资源并重新打包 Debug，包内资源哈希与测试二进制一致。
- 桌面新增集成测试编译、Clippy（包含测试，warnings as errors）、Rust 格式和最终 Debug 构建通过。

未修改真实服务器的 Agent 或 MCP 配置。已有服务器连接需重连以加载新组件。当前验证覆盖 Linux x86_64；ARM64 组件由发布流水线另行构建，本次未在 ARM64 上实测。未发布版本。

## 保留原有导航布局

按最新反馈，远程 MCP 模式保留 Agent、项目导航和右上角「+」按钮，使用置灰状态与说明提示阻止尚不支持的管理操作；切回 Skill Hub 后原按钮恢复可用。各入口均维持原有尺寸和位置。

35 个导航、选择持久化及远程 MCP 回归测试通过，包含不可用入口点击不跳转、不调用管理接口，以及切换 Hub 时复用原导航按钮。TypeScript、格式、diff 检查及 Debug 构建通过。原生 Debug 已重新连接用户原先的服务器，核对 Agent 与项目导航均保留、远程只读卡片正常显示。

右上角「+」随后恢复为可见的置灰圆形按钮，悬停说明远程 MCP 暂不支持添加；本机及 Skill 页面仍使用正常新增操作。全量 27 文件、218 个前端测试通过，包含置灰按钮点击不打开编辑器、不调用管理接口，以及切回本机后恢复新增功能。TypeScript、格式、diff 和 Debug 构建通过，原生远程 MCP 界面已确认按钮显示在原位置。
