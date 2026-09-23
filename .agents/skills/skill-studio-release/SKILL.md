---
name: skill-studio-release
description: 用户明确要求发布 Skill Studio 时使用，负责版本同步、验证、提交推送、标签、GitHub Release 和 Homebrew；普通 commit、push、调试、发布讨论和规则修改不触发。
---

# Skill Studio 发布

由当前代理完成。用户要求发布即授权本次范围内的提交、推送和正式发布，不逐阶段索要确认，不自动委派代理。

## 准备与提交

1. 一次检查 main、origin、工作区和最新稳定版本；未指定版本时递增 patch。保留无关文件，已有未完成发布先续跑。
2. `python3 scripts/release.py set-version X.Y.Z`，补充真实的 `CHANGELOG.md` 说明。
3. 复用当前任务有依据的检查结果，只补受修改影响或缺失的项。缺少记录时运行一次 `python3 scripts/release.py check`，不要再逐条重复其中的检查。版本同步后至少运行 `verify` 和发布脚本单测。Rust 使用仓库 `rust-toolchain.toml`，不要另用浮动 stable。
4. 按明确文件列表暂存、审查并提交，push main。不要夹带用户数据、测试记录、密钥或构建产物。

## 一次执行到完成

提交推送后只启动一个命令：

```sh
python3 -u scripts/release.py release X.Y.Z
```

脚本自动等待精确提交的 main CI、推标签、等待三平台 Release（含 Homebrew），最后一次核验五个安装包。成功返回 Release URL；失败返回非零退出码和失败阶段。无需另跑 `ci-gate`、`publish-tag`、`verify-release` 或手查资产。不在本地重新打包、不重启 Debug App。

- 使用工具的异步进程执行，保留 session ID，后续只等待同一进程；每次等待时长遵守宿主限制。脚本已在内部每 60 秒查询一次，无需模型再运行 `gh run list/view/watch`、`tail`、解析日志或逐 job 确认。
- 正常输出仅有阶段变化。向用户说明目标版本和实际阶段变化，结束后汇报结果；宿主要求定时进度时给最短更新，不为播报额外查状态、不反复解释“仍在等待”。
- 构建可能持续数十分钟，`queued` / `in_progress` 不代表失败。脚本默认每条流水线最多等待 3600 秒，发现新流水线最多 300 秒；超时不取消远程任务。
- 完成后简报版本、最终提交、Release 链接和验证结果。任何门禁未通过均不得宣称发布完成。

## 仅失败或中断时介入

- 保留版本、SHA、输出中的 run ID。进程仍在时继续等待；进程已结束才判断失败，勿启动重复发布进程。
- 相同 main/HEAD 下重新运行同一 `release` 命令可复用已有 CI、标签和 Release，不重建工作流、不覆盖已公开资产。main 已变化时，按原标签/SHA 查询并等待已有 run，完成后只运行 `verify-release X.Y.Z`。
- 仅失败时读取对应 job 日志。网络/沙箱读取失败不等于 CI 失败或 Release 不存在。可恢复的外部故障最多重试一次失败 jobs；同因再次失败先诊断，不无限重跑。
- 标签前代码修复：提交修复后重新执行串行入口。标签后代码修复：使用新版本，不移动标签、不覆盖公开安装包。Homebrew 单独失败时只修复并重试该 job。
- `publish-assets` 仅由标签流水线调用，不绕过发布门禁。
