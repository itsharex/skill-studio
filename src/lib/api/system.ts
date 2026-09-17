import { invoke } from "@/lib/api/transport";

export const systemApi = {
  /** 启动期错误；非空时前端渲染恢复提示而不是主界面 */
  async getInitError(): Promise<string | null> {
    return await invoke("get_init_error");
  },

  async getVersion(): Promise<string> {
    return await invoke("get_app_version");
  },

  async setWindowTheme(theme: string): Promise<void> {
    await invoke("set_window_theme", { theme });
  },

  /** 用系统默认程序打开路径（Finder / 资源管理器） */
  async revealPath(path: string): Promise<void> {
    await invoke("reveal_path", { path });
  },
};
