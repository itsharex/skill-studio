# OpenCode v2、Pi、Grok Build MCP 接入验证

日期：2026-09-24。只接入本机 MCP；OpenCode 按用户要求仅支持 v2。

## 实现与边界

- 三个 Agent 接入 MCP Hub 来源统计、导航、全局安装、分组、项目接入、直连与 Studio 代理；沿用现有管理开关、备份、事务和冲突保护。
- OpenCode v2 使用 `mcp.servers`、命令数组、`environment` 和 `disabled`；读取 JSON／JSONC，编辑时保留无关属性和注释。发现 v1 结构拒绝改写。新文件使用 v2 格式。
- Pi 使用 [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) 的专属全局 `mcp.json` 与项目 `.pi/mcp.json`；界面明确提示扩展安装命令。没有自动安装扩展或修改用户的 Pi 包设置，共享配置与插件导入仍由适配器管理。
- Grok Build 使用全局／项目 `config.toml` 的 `mcp_servers`，HTTP 请求头为 `headers`；全局 `disabled_mcp_servers` 同样影响项目来源，Studio 不擅自解除原生停用。校验 Grok 工具命名要求。
- 配置路径沿用 Studio 目录覆盖和 Agent 环境变量，OpenCode 优先编辑已有文件。移除项目接入覆盖全部新增原生路径。
- 直连保存客户端扩展字段；Studio 代理不接受无法解释的客户端字段、变量引用和相对工作目录。此次新增接入支持 stdio、Streamable HTTP；不做 SSE 转换。

配置依据：[OpenCode v2 MCP](https://opencode.ai/v2/docs/mcp-servers)、[OpenCode 配置](https://opencode.ai/v2/docs/config)、[Pi 适配器](https://github.com/nicobailon/pi-mcp-adapter)、[Grok Build MCP](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/07-mcp-servers.md)。JSONC 编辑使用 `jsonc-parser` 的 CST API。

## 自动化验证

- 全量前端：25 个文件、205 个测试通过，包含三个新 Agent 的导航、项目接入、重复安装检查与 Pi 扩展提示。
- MCP 后端：41 个既有测试及 10 个新增测试通过；另有 1 个显式启用的 CLI fixture 导出测试，已单独执行。
- 新测试覆盖原生格式转换、启停字段、JSONC 导入／注释／重复属性、网关入口识别、托管／还原、管理开关、备份恢复、分组、项目撤回、多文件冲突、Grok 全局停用及目录覆盖。
- TypeScript、Prettier、`cargo fmt`、MCP／桌面 `cargo clippy --all-targets -- -D warnings`、`git diff --check` 与 macOS Debug 构建通过。
- 网关测试需要监听本机临时端口，使用沙盒外测试权限运行；测试不使用真实服务商凭据。

## 原生 GUI

在独立 `SKILL_STUDIO_TEST_HOME` 中启动 Debug App：

- MCP Hub 正确显示 OpenCode、Pi、Grok Build 三个导航入口和来源计数。
- Pi 分组页展示扩展依赖提示；创建包含测试服务的 `MCP smoke` 分组，保存并启用后显示“使用中”和“已启用 1 个分组”。
- OpenCode MCP 页展示 v2 提示和已配置服务计数。顶部继续保持单行。
- 操作只使用隔离测试配置，未通过 GUI 修改用户真实 Agent 配置。

## 真实客户端协议验证

使用 Rust `management::save` 生成配置，连接本地 Python MCP 模拟服务；摘要见 [结果文件](2026-09-24-additional-mcp-results.json)。

| 客户端                | 直连                                                        | Studio 代理                           |
| --------------------- | ----------------------------------------------------------- | ------------------------------------- |
| OpenCode 2.0.15       | 私有服务 API 返回 `sample: connected`                       | 私有服务 API 返回 `sample: connected` |
| Grok Build 1.0.40     | `mcp doctor sample --json` 握手成功、发现 1 个工具、healthy | 握手成功、发现 1 个工具、healthy      |
| pi-mcp-adapter 2.37.0 | 适配器加载生成配置、发现 `echo`，调用返回 `studio-ok`       | 同样调用成功并返回 `studio-ok`        |

Pi 适配器和 Pi 0.87.1 仅安装在构建目录的临时运行环境；验证调用的是适配器实际配置加载器及 MCP 客户端，没有发起模型请求，也没有修改全局 Pi 安装。

OpenCode 首次列表可能先返回空列表，连接建立后状态更新。初次后台服务测试遇到默认端口冲突；最终改用独立 `opencode serve` 子进程、临时端口和该进程的临时认证读取状态，结束时只关闭自己创建的子进程，没有调用全局 `service set/stop`。此结果确认配置识别与 MCP 连接，不等同于真实模型或服务商 OAuth 调用验证。

验证结束后，临时 Studio 网关已停止；最初由 CLI 创建的 OpenCode 测试服务经 PID 与隔离目录标记双重核验后停止。未使用全局服务停止命令。

## 提示布局调整

OpenCode v2 与 Pi 的使用说明移到 MCP 分组统计栏右侧的信息按钮，点击通过浮层查看，不再占用独立提示行。添加 MCP 弹窗继续显示对应依赖说明。相关 26 个前端测试、TypeScript、格式检查与 Debug 构建通过；现有 Pi 提示测试检查默认收起；展开交互通过原生 GUI 验证。

后续补齐 Skill 分组页：OpenCode、Pi、Grok Build 的 Skill 管理说明同样移入统计栏右侧的信息按钮，与 MCP 共用 `HelpPopover`。原生 GUI 对比 OpenCode Skill、Claude Code Skill 和 Pi MCP，统计栏及空列表起点一致；点击 Skill／MCP 信息按钮可展开说明，列表位置保持不变。30 个相关前端测试、TypeScript、格式及 Debug 构建通过。遵循测试配置中的约定，将 Radix 浮层展开验证放在原生 GUI 中，避免 jsdom/floating-ui 布局导致超时。Debug 停在已修复的 OpenCode Skill 分组页。
