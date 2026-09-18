# Linux Debug helper 验证

2026-09-18，使用用户指定的私有 Linux x86_64 测试机，构建基于 `0adfb66` 的最新 core/service/helper 源码；本地未提交 UI 文案不影响 helper。

- 复用先前隔离的 `/tmp` Rust 1.98.1 工具链与 vendored 离线依赖。
- Linux `cargo test --offline --workspace -j 4`：235 通过，0 失败，1 个显式忽略测试未运行。
- `cargo build --offline -p skill-studio-remote -j 4`：Debug 构建成功。
- `scripts/verify_remote_helper.py`：隔离 HOME 下原生启停、重复停用、重连恢复、无关配置保留通过；真实配置只读扫描、写入拒绝通过，前后文件哈希一致。
- 桌面 `live_desktop_ssh_deploy_and_project_roundtrip`：真实 SSH 部署、Hub 托管、分组、项目写入、备份、断开重连通过。
- 本轮增强该显式 live 测试：上传 150,123 字节二进制附件，覆盖多个 64 KiB 分块及不足整块的尾部；本地 SHA-256 与服务器实际文件一致。
- 测试使用隔离 `/tmp` fixture，没有操作真实 Agent 的 skills 或项目配置。部署会在用户 helper 二进制缓存目录保存按内容哈希命名的程序。

通过后已将构建复制到本地 `src-tauri/resources/remote/skill-studio-remote-linux-x86_64` 和 `target/debug/resources/remote/skill-studio-remote-linux-x86_64`，两者 SHA-256 均为：

```
6462c7c335d482ac810a740cfd9166df4634a5adb82066d8539b98d3e22b7cce
```

Debug 资源为 Git 忽略的本机构建产物。已连接会话需要断开重连才使用新程序。没有验证 ARM64，也没有以真实密码/跳板机不同配置穷举所有认证方式。
