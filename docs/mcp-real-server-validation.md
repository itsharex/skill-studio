# MCP 真实服务验证

验证日期：2026-09-19。本次验证针对当前工作区 Debug 实现，不代表已经发布。

## 服务与隔离

使用官方 `@modelcontextprotocol/server-memory@2026.8.31` 和 `@modelcontextprotocol/server-filesystem@2026.8.31`。来源：[官方服务器仓库](https://github.com/modelcontextprotocol/servers)。软件包只安装到临时目录，Filesystem 只允许访问测试目录，Memory 使用独立的 `MEMORY_FILE_PATH`。

自动化测试使用临时目录中的真实 Claude JSON／Codex TOML 配置、实际 Node MCP 进程，以及实际编译的 Skill Studio `--mcp-daemon`／`--mcp-client`。界面测试另外启动设置了 `SKILL_STUDIO_TEST_HOME` 的独立 macOS 测试应用；Codex 配置目录也指向临时目录。没有修改用户现有的 MCP 配置或登录缓存。

## 验证结果

| 场景 | 结果 |
| --- | --- |
| JSON 添加 Memory、TOML 添加 Filesystem | 真实界面保存成功 |
| 同时安装到 Claude 和 Codex、自动扫描来源 | 成功，两个来源合并显示 |
| 从界面实际写出的配置启动 MCP | Memory 9 个工具、Filesystem 14 个工具 |
| Memory 实体创建、查找、读取、删除与跨进程持久化 | 成功 |
| Filesystem 写文件，再从工具及磁盘读取 | 内容一致 |
| 分组保存不立即应用、启用、切换、停用 | 成功 |
| 分组编辑、待应用提示、重新应用、排序 | 成功；排序由真实配置层集成测试验证 |
| 使用中的组／服务删除保护、停止后删除 | 成功 |
| 同一 MCP 被多个 Agent 的组引用 | 相互隔离，切换 Claude 不改 Codex 配置 |
| 直连转网关，保留原入口名称 | 成功 |
| 界面“启动并测试”连接真实 Memory | 显示“连接成功 · 9 个工具” |
| 实际网关与两个编译后的客户端调用同一 Memory | 创建及读取成功 |
| 停止网关后新连接 | 按预期失败 |
| 外部修改后切换／停用 | 拒绝覆盖，配置与分组状态不被部分修改 |
| 删除组、移出服务、配置还原与清理 | 测试条目清空，provider、其他作用域和注释保留 |

发现并修复一个界面问题：macOS 在手工输入 TOML 时可能自动把直引号替换为弯引号，导致解析失败。两个配置文本框已关闭自动更正、自动大写和拼写检查；相同手工输入在真实窗口复测解析成功。

本轮未验证需要第三方账号交互的真实 OAuth 登录／刷新／撤销，也未验证远程 SSH（当前 MCP 功能只支持本机）。没有以此声称所有服务商或所有 MCP 扩展都兼容。

## 重跑真实服务集成测试

```sh
mcp_test_dir="$(mktemp -d)"
npm install --prefix "$mcp_test_dir" --cache "$mcp_test_dir/npm-cache" --no-audit --no-fund \
  @modelcontextprotocol/server-memory@2026.8.31 \
  @modelcontextprotocol/server-filesystem@2026.8.31
cargo build -p skill-studio
MCP_REAL_SERVER_DIR="$mcp_test_dir" cargo test -p skill-studio-mcp \
  --test real_servers -- --ignored --nocapture
```

可设置 `MCP_TEST_NODE` 指定 Node 可执行文件。该测试默认忽略，避免常规单测依赖 npm 安装及桌面程序构建。测试创建的配置和服务数据由临时目录自动清理；npm 安装目录可在测试后删除。
