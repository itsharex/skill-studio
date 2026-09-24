# OpenCode、Pi、Grok Build Skill 接入验证

日期：2026-09-24。范围：Skill 管理；不扩展 MCP 支持。

## 目录依据

- OpenCode 官方 Skill 文档：`https://opencode.ai/docs/skills/`
- Pi 官方文档及源码：`badlogic/pi-mono/packages/coding-agent/docs/skills.md`、`src/config.ts`。全局目录为 `~/.pi/agent/skills`，项目目录为 `.pi/skills`。
- Grok Build 官方文档：`xai-org/grok-build/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md`、`05-configuration.md`。
- 本次管理原生标准目录下直接含 `SKILL.md` 的目录，以及 `~/.agents/skills` 中的共享 Skill。没有接入原生单项启停、权限配置、插件资源与跨厂商兼容加载。

## 自动化验证

- `cargo test -p skill-studio-core`：231 通过，1 个既有测试忽略。
- `cargo test -p skill-studio-service -p skill-studio-remote --no-fail-fast`：16 通过。
- `pnpm exec vitest run`：199 通过。
- TypeScript、Prettier、`cargo clippy --workspace --all-targets -- -D warnings`、`git diff --check` 通过。
- `pnpm tauri build --debug --bundles app --config src-tauri/tauri.debug.conf.json` 通过。

新增测试覆盖三个 Agent 的专属全局目录与项目目录、目录覆盖和环境变量、共享根去重与安装探测、复制／软链安装与移除、托管／还原／删除恢复、分组切换／退出管理、手动 Skill 保留、原生配置字节不变、多 Agent 项目部署及撤回。前端验证新 Agent 导航、MCP 隔离、项目实际目录、分组保存与设置持久化。

## 真实 GUI 验证

使用临时 `SKILL_STUDIO_TEST_HOME` 和测试 Skill，在 macOS Debug App 中操作：

- Skill Hub 正确显示三个 Agent 的来源、品牌图标及共享来源。
- 打开 OpenCode 分组页和已安装 Skill 页，创建并保存测试分组。
- 项目页显示 `.opencode/skills`、`.pi/skills`、`.grok/skills` 及对应项目已有 Skill。
- 同时选择三个 Agent 与 `studio-demo`，点击“写入项目”；实际文件系统中三个目录均存在 `studio-demo/SKILL.md`，配置记录三条独立部署。
- 切至 MCP Hub，仅保留 Claude Code 与 Codex 入口。
- 测试 App 已退出，临时目录保留用于复核，没有改动真实 Agent 的 Skill 配置。

本机另确认 OpenCode v2.0.15、Grok Build 1.0.40 的 CLI 可运行。Grok 的 `inspect --json` 识别临时全局 Skill；临时项目未受信任，Grok 未加载其项目 Skill，这属于 Agent 的信任策略，不通过修改用户信任设置绕过。Pi 本机未安装，未验证模型实际调用。上述 GUI 与文件部署验证不等同于三种 Agent 的模型调用测试。

原生启停未接入的 Agent 显示“已安装”数量，不承诺其原生权限配置下的实际加载状态；组外手动 Skill 保留，分组停用只撤回 Studio 自己部署的副本。

## 图标来源修正

按用户要求改用 CC Switch 的 `src/icons/extracted/index.ts`，固定来源提交 `da193d4f7a6ce3710623c312245c752376c0d036`。OpenCode 使用带灰色内面板的双色标记；Pi 改为像素标记；Grok Build 按 CC Switch 的 `grokbuild` → `grok` 映射取图，其轮廓与原实现一致。许可与改编说明见 `THIRD_PARTY_NOTICES.md`。

- 脚本逐一比对三个图标的 SVG 路径与 viewBox，均与固定来源提交一致。
- TypeScript、修改文件的 Prettier、`git diff --check` 和 macOS Debug App 构建通过。
- 使用前述隔离测试目录启动 Debug App，在浅色／深色模式检查导航、Hub 来源筛选、Skill 卡片来源标记，以及深色设置页 Agent 选项。图标比例正常，OpenCode 的深色填充适配可见。
- 测试后恢复“跟随系统”外观并退出测试 App。
