# 窗口最小尺寸与工具栏布局验证

日期：2026-09-24。

## 最终行为

- 默认窗口由 1100×700 扩大为 1360×820，最小尺寸由 960×620 调整为 1140×620；保留已有窗口状态恢复逻辑。
- 主视图顶部使用固定单行 CSS Grid，依次显示应用信息、搜索、导航和新增按钮。取消此前的单行／双行断点切换。
- 搜索框最大宽度为 208px，空间有限时可收缩至 128px；搜索和新增按钮的 portal 容器保持稳定。
- 移除刚增加的窗口宽窄切换动画及其专用 hook、测试；保留原有页面和 Hub 切换动画。
- Skill Hub 来源筛选与统计分行、左对齐，并以分隔线区分；来源标签不拆开图标和名称。

## 验证

- `pnpm typecheck`、修改文件的 Prettier、`git diff --check` 通过。
- `pnpm exec vitest run tests/appShell.test.tsx tests/additionalAgents.test.tsx`：2 个文件、30 个测试通过。
- `pnpm tauri build --debug --bundles app --config src-tauri/tauri.debug.conf.json` 通过。
- 真实 macOS Debug App GUI：通过 Window → Move & Resize → Top Left 尝试缩至四分之一屏，窗口受到 1140×620 最小尺寸约束；Retina 截图为 2282×1240 物理像素（含窗口边缘）。
- 最小尺寸下，应用信息、搜索框、五个 Agent、项目与新增按钮均完整显示在同一行；Skill Hub 来源筛选及统计区排列正常。

最小宽度从 1200px 收窄至 1140px 后，重新构建 Debug App 并复测原生最小尺寸和单行布局通过；本轮仅修改窗口配置与文档，复用前一轮类型和测试结果。Debug App 保持打开，停在最小尺寸的 Skill Hub。
