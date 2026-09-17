import { invoke } from "@/lib/api/transport";
import type { AgentInfo } from "@/types";

export const agentsApi = {
  /** skipCliProbe 跳过 --version 子进程探测，用于高频刷新 */
  async list(skipCliProbe = false): Promise<AgentInfo[]> {
    return await invoke("list_agents", { skipCliProbe });
  },
};
