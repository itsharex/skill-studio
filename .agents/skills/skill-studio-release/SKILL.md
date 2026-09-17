---
name: skill-studio-release
description: 发布 Skill Studio 新版本时使用，包括版本同步、验证、提交推送、标签、GitHub Release 和 Homebrew；仅在用户明确要求发布时触发，普通 commit、push、调试或发布方案讨论不触发。
---

# Skill Studio 发布

由 `gpt-5.6-sol` 子代理执行（配置见 `.codex/agents/release.toml`），主代理审核范围并汇总结果；模型不可用时报告，不自动替换。所有命令在仓库根目录运行，需要 Python 3.11+、pnpm、Rust、git 和已认证的 gh。

## 流程

1. 检查 `git status`、当前分支、origin、远程 main 和已有标签；只从 main 发布，先处理冲突，保留用户未授权的文件。检查用户指定版本；未指定则在最新稳定版本基础上递增 patch，不复用已发布版本。
2. 审查本次差异，运行 `python3 scripts/release.py set-version X.Y.Z` 同步四处版本，在 `CHANGELOG.md` 添加 `## vX.Y.Z` 和真实变更说明，不填占位文字。
3. 运行 `python3 scripts/release.py check`；检查失败先修复并重跑相关检查，代码再次变化后重跑完整检查。UI 或文件管理行为变化需完成相应回归；使用临时数据，不修改用户的语雀 skill。
4. 按明确文件列表暂存审查过的改动，检查 staged diff 后提交并 push main；禁止 `git add .`、强推及夹带用户安装的 skill、密钥或测试产物。发布 Skill 和 agent 配置只有属于本次审查范围才可提交。
5. 查询并等待本次提交的 main push CI，通过 `python3 scripts/release.py ci-gate --sha <提交SHA>` 确认成功；随后运行 `python3 scripts/release.py publish-tag X.Y.Z`。此命令再次校验版本、工作区、远程 main 和精确提交的 CI，才推送标签。
6. 等待该标签的 Release 流水线完成：构建 macOS universal DMG、Windows EXE/MSI、Linux AppImage/DEB，校验五个安装包后公开草稿，再更新指定版本的 Homebrew Cask。
7. 运行 `python3 scripts/release.py verify-release X.Y.Z`；只有精确提交的 CI、Release（含 Homebrew）及五个非空安装包都通过，才报告发布完成，并附版本、提交和 Release 链接。

## 失败与重试

- 任何门禁失败都停在当前阶段，报告失败链接和原因，不绕过检查。
- 同一提交可重试失败的 GitHub Actions jobs；已公开 Release 只校验，不覆盖安装包；禁止删除或移动已推送标签，代码修复后使用新版本。
- GitHub Release 已公开而 Homebrew 失败时，明确报告部分完成，修复后重跑失败 job，不重复发布。
- `publish-assets` 仅由标签流水线调用；本地使用 `verify`、`check`、`ci-gate` 和 `verify-release` 验证，不手动跳过流水线发布。
