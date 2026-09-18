---
name: skill-studio-release
description: 用户明确要求发布 Skill Studio 时使用，负责版本同步、验证、提交推送、标签、GitHub Release 和 Homebrew；普通 commit、push、调试、发布讨论和规则修改不触发。
---

# Skill Studio 发布

当前代理直接完成发布，沿用当前任务的上下文和验证结果，不指定模型、不自动委派子代理。用户要求发布即授权本次范围内的提交、推送、标签和正式发布，无需逐阶段确认。

## 开始前：一次确认范围和状态

- 在仓库根目录操作。检查分支、origin、工作区、远程 main、标签及现有 Release；只从 main 发布，保留无关文件，遇到分叉先处理，不强推、不自动覆盖工作区。
- 使用用户指定版本；未指定或仅说“小更新”时，在最新稳定版本上递增 patch。已有未完成发布先判断是否续跑，不为重试机械增加版本。
- 确认 Python 3.11+、pnpm、Rust、git、gh 可用及 GitHub 认证、网络正常。网络或沙箱错误不等于 CI 失败，也不等于 Release 不存在；按实际权限处理后重试读取，勿据此重复创建。
- 发布范围从当前 diff 和已有任务记录确定。不要重新做全项目审计，也不要顺手清理无关文件、重启 Debug App 或部署远程 Debug helper。正式 Linux helper 由 Release 流水线从同一提交构建。

## 固定流程

1. `python3 scripts/release.py set-version X.Y.Z` 同步四处版本；在 `CHANGELOG.md` 添加真实的 `## vX.Y.Z` 说明。
2. 完成下面的本地检查策略，修复实际失败后再提交。
3. 按明确文件列表暂存，检查 staged diff，提交并 push main，记录完整 SHA。禁止 `git add .`，不夹带密钥、用户 skill、私有测试记录或构建产物。
4. 找到该 SHA 的 `ci.yml` main push run，记录 run ID 并等待成功。运行 `python3 scripts/release.py publish-tag X.Y.Z`；脚本已校验版本、工作区、远程 main 和精确 SHA 的 CI，无需在它之前再单独运行 `ci-gate`。
5. 找到该标签、该 SHA 的 `release.yml` run，等待全部完成。流水线负责 Linux helper、三平台构建、五包校验、正式 Release 和 Homebrew；不要在本地再打一遍安装包。
6. 运行一次 `python3 scripts/release.py verify-release X.Y.Z`，通过后报告版本、提交、Release 链接及门禁结果。它已核验精确提交的 CI、Release（含 Homebrew）与五个非空安装包，无需再手动重复查询每个资产。

## 本地检查：复用有依据的结果

- `python3 scripts/release.py check` 是完整本地检查入口，包含发布脚本测试、前端类型/格式/测试/构建、Rust fmt/clippy/工作区测试。缺少可信的现有检查记录时运行一次，不先把内部命令逐个执行后再运行它。
- 当前任务已有通过结果时，按检查所覆盖的文件和依赖复用，仅补跑缺项或受后续修改影响的检查。版本同步后至少运行 `python3 scripts/release.py verify` 和发布脚本单测；Rust 版本或依赖变化仍需重新执行受影响的 Rust 检查。不能仅凭“之前通过了”推断未知源码状态也通过。
- 回归测试围绕实际行为变化；与本次无关的远程实机测试不作为每次发布的附加门禁。使用临时数据，不修改用户实际 skill。
- 修改后先重跑失败项及受影响项，不因进入新阶段重跑全部检查。最终精确 SHA 的完整 main CI 始终必需，本地结果不能替代它。

## 等待与恢复：从已有阶段继续

- 获取 run ID 后复用它，不反复列出所有 runs。可用 `gh run watch <ID> --interval 60 --exit-status`，输出重定向到临时日志，通过异步进程等待；每次工具等待不超过运行环境限额。需要查询时只取紧凑状态，失败才读取相关 job 日志。
- `queued` / `in_progress` 是正常等待，不调用成功门禁制造报错，不因此重跑 workflow。v0.3.2 的参考耗时是 CI 约 4 分钟、Release 约 16 分钟，其中 macOS universal 打包约 13 分钟；这是观察值，不是超时阈值或速度承诺。
- 报告实际阶段，例如“CI 已通过，正在构建三平台安装包”。遵守宿主要求的进度频率；没有变化时保持简短，不把正常等待描述成阻碍、不重复展开日志。保留版本、SHA、run ID 和已通过检查的简短记录，恢复任务时先读取状态再续跑。

| 已有状态 | 下一步 |
| --- | --- |
| main 已推送，CI 未完成 | 等待该 SHA 的 CI，不重复提交 |
| CI 通过，标签未推送 | 执行 `publish-tag` |
| 标签已推送，Release 运行中 | 等待对应 run，不删改标签 |
| workflow 失败 | 读取失败 job，判断代码问题或外部故障；可恢复的外部故障仅重试失败 jobs |
| Release 已公开，Homebrew 失败 | 明确报告部分完成，处理原因后仅重跑失败 job，不重新上传安装包 |
| Release 与 Homebrew 成功 | 执行 `verify-release` 后结束 |

- 同一原因的自动重试最多一次；再次失败先诊断，权限、凭据、服务持续不可用或需用户决策时，报告失败链接、原因和具体阻碍，不无限重试。
- 标签推送前的代码修复回到本地检查和提交阶段，新 SHA 重新等 CI；标签推送后的代码修复必须使用新版本，不删除、移动标签，不覆盖公开安装包。
- `publish-assets` 仅由标签流水线调用，不手工绕过流水线公开发布。任何门禁失败都停止推进下一阶段；全部门禁通过才称发布完成。
