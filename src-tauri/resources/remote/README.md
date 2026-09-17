# Linux remote helper resources

Release builds generate `skill-studio-remote` for each supported Linux architecture
and place the binaries here before packaging the desktop app:

- `skill-studio-remote-linux-x86_64`
- `skill-studio-remote-linux-aarch64`

The generated binaries are intentionally not tracked in Git. Local development can
build and copy a matching helper into this directory. The desktop validates the ELF
architecture, uploads via SSH, checks SHA-256 remotely, and verifies the helper
version and protocol handshake. If an architecture's binary is absent, the UI asks
for a matching local binary instead of executing local management commands.
