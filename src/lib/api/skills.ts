import { invoke } from "@/lib/api/transport";
import type {
  CatalogSkill,
  LocalSkill,
  LinkMode,
  LinkReport,
  Skill,
  SkillView,
} from "@/types";

export const skillsApi = {
  async discoverLocal(path: string): Promise<LocalSkill[]> {
    return await invoke("discover_local_skills", { path });
  },
  async importLocal(path: string): Promise<Skill> {
    return await invoke("import_local_skill", { path });
  },
  async searchCatalog(query: string): Promise<CatalogSkill[]> {
    return await invoke("search_catalog_skills", { query });
  },
  async installCatalog(source: string, skillId: string): Promise<Skill> {
    return await invoke("install_catalog_skill", { source, skillId });
  },
  async scan(): Promise<SkillView[]> {
    return await invoke("scan_skills");
  },

  async register(
    skillIds: string[],
    agentIds: string[],
    mode?: LinkMode,
    force = false,
  ): Promise<LinkReport> {
    return await invoke("register_skills", {
      skillIds,
      agentIds,
      mode: mode ?? null,
      force,
    });
  },

  async unregister(
    skillIds: string[],
    agentIds: string[],
    force = false,
  ): Promise<LinkReport> {
    return await invoke("unregister_skills", { skillIds, agentIds, force });
  },

  /** 走 agent 原生配置启停，不动文件 */
  async setEnabled(
    skillId: string,
    agentId: string,
    enabled: boolean,
  ): Promise<void> {
    await invoke("set_skill_enabled", { skillId, agentId, enabled });
  },

  async adoptToHub(skillId: string): Promise<Skill> {
    return await invoke("adopt_to_hub", { skillId });
  },

  async releaseFromHub(skillId: string): Promise<Skill> {
    return await invoke("release_from_hub", { skillId });
  },

  async prune(): Promise<number> {
    return await invoke("prune_missing");
  },
};
