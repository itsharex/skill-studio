import { invoke } from "@tauri-apps/api/core";
import type { LinkMode, LinkReport, ProjectBinding } from "@/types";

export const projectsApi = {
  async setEnabled(projectId: string, enabled: boolean): Promise<LinkReport> {
    return await invoke("set_project_enabled", { projectId, enabled });
  },
  async reorder(projectIds: string[]): Promise<ProjectBinding[]> {
    return await invoke("reorder_projects", { projectIds });
  },
  async list(): Promise<ProjectBinding[]> {
    return await invoke("list_projects");
  },

  async create(name: string, root: string): Promise<ProjectBinding> {
    return await invoke("create_project", { name, root });
  },

  async update(
    projectId: string,
    patch: {
      name?: string;
      agentIds?: string[];
      skillIds?: string[];
      groupIds?: string[];
      linkMode?: LinkMode;
    },
  ): Promise<ProjectBinding> {
    return await invoke("update_project", {
      projectId,
      name: patch.name ?? null,
      agentIds: patch.agentIds ?? null,
      skillIds: patch.skillIds ?? null,
      groupIds: patch.groupIds ?? null,
      linkMode: patch.linkMode ?? null,
    });
  },

  /** 只删绑定，不动已写进项目目录的文件（可能已提交进 git） */
  async remove(projectId: string): Promise<void> {
    await invoke("delete_project", { projectId });
  },

  async apply(
    projectId: string,
    selection?: Pick<
      ProjectBinding,
      "agentIds" | "skillIds" | "groupIds" | "linkMode"
    >,
  ): Promise<LinkReport> {
    return await invoke("apply_project", {
      projectId,
      selection: selection ?? null,
    });
  },

  async unapply(
    projectId: string,
    skillIds: string[],
    force = false,
  ): Promise<LinkReport> {
    return await invoke("unapply_project", { projectId, skillIds, force });
  },

  async writeGitignore(projectId: string): Promise<boolean> {
    return await invoke("write_project_gitignore", { projectId });
  },

  async pickDirectory(defaultPath?: string): Promise<string | null> {
    return await invoke("pick_directory", {
      defaultPath: defaultPath ?? null,
    });
  },
};
