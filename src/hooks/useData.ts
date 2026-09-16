import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  agentsApi,
  groupsApi,
  projectsApi,
  settingsApi,
  skillsApi,
  systemApi,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { toastLinkReport } from "@/lib/linkReport";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import type { LinkMode, SettingsPatch } from "@/types";

/* ─────────────────── 查询 ─────────────────── */

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => agentsApi.list(false),
    // CLI 探测要起子进程，不必频繁重跑
    staleTime: 60_000,
  });
}

export function useSkills() {
  return useQuery({
    queryKey: queryKeys.skills,
    queryFn: () => skillsApi.scan(),
  });
}

export function useGroups() {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => groupsApi.list(),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => projectsApi.list(),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => settingsApi.get(),
  });
}

export function useBackups() {
  return useQuery({
    queryKey: queryKeys.backups,
    queryFn: () => settingsApi.listBackups(),
  });
}

export function useAppVersion() {
  return useQuery({
    queryKey: queryKeys.version,
    queryFn: () => systemApi.getVersion(),
    staleTime: Infinity,
  });
}

/**
 * 用户在 Studio 之外改动了 skill 目录时刷新。
 * 后端 watcher 已做 400ms 去抖，这里直接失效即可。
 */
export function useSkillsAutoRefresh() {
  const qc = useQueryClient();
  useTauriEvent("skills-changed", () => {
    void qc.invalidateQueries({ queryKey: queryKeys.skills });
  });
}

/* ─────────────────── 变更 ─────────────────── */

/** 任何会改动文件或配置的操作都要连带刷新 skill 状态 */
function useInvalidateAfterWrite() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.skills });
    void qc.invalidateQueries({ queryKey: queryKeys.groups });
    void qc.invalidateQueries({ queryKey: queryKeys.projects });
    void qc.invalidateQueries({ queryKey: queryKeys.backups });
  };
}

export function useRegisterSkills() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (v: {
      skillIds: string[];
      agentIds: string[];
      mode?: LinkMode;
      force?: boolean;
    }) => skillsApi.register(v.skillIds, v.agentIds, v.mode, v.force ?? false),
    onSuccess: (report) => toastLinkReport(report, "注册"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useUnregisterSkills() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (v: {
      skillIds: string[];
      agentIds: string[];
      force?: boolean;
    }) => skillsApi.unregister(v.skillIds, v.agentIds, v.force ?? false),
    onSuccess: (report) => toastLinkReport(report, "移除"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useSetSkillEnabled() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (v: { skillId: string; agentId: string; enabled: boolean }) =>
      skillsApi.setEnabled(v.skillId, v.agentId, v.enabled),
    onSuccess: (_r, v) =>
      toast.success(v.enabled ? "已启用 skill" : "已停用 skill"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useAdoptToHub() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.adoptToHub(skillId),
    onSuccess: (skill) => toast.success(`已收编到 Hub：${skill.name}`),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function usePrune() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: () => skillsApi.prune(),
    onSuccess: (n) =>
      n > 0
        ? toast.success(`已清理 ${n} 条失效引用`)
        : toast.info("没有失效引用"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useCreateProject() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (v: { name: string; root: string }) =>
      projectsApi.create(v.name, v.root),
    onSuccess: (p) => toast.success(`已添加项目：${p.name}`),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.remove(projectId),
    onSuccess: () => toast.success("项目已移除（项目目录里的文件未变动）"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useApplyProject() {
  const invalidate = useInvalidateAfterWrite();
  return useMutation({
    mutationFn: (v: {
      projectId: string;
      selection: {
        agentIds: string[];
        skillIds: string[];
        groupIds: string[];
        linkMode: LinkMode;
      };
    }) => projectsApi.apply(v.projectId, v.selection),
    onSuccess: () => toast.success("项目选择已保存并写入"),
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}

export function useWriteProjectGitignore() {
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.writeGitignore(projectId),
    onSuccess: (added) =>
      added
        ? toast.success("已写入 .gitignore")
        : toast.info(".gitignore 里已有该条目"),
    onError: (e: unknown) => toast.error(String(e)),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => settingsApi.update(patch),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings);
      // 目录覆盖会改变扫描位置
      void qc.invalidateQueries({ queryKey: queryKeys.skills });
      void qc.invalidateQueries({ queryKey: queryKeys.agents });
    },
    onError: (e: unknown) => toast.error(String(e)),
  });
}

export function useRestoreBackup() {
  const invalidate = useInvalidateAfterWrite();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => settingsApi.restoreBackup(path),
    onSuccess: () => {
      toast.success("已从备份恢复");
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (e: unknown) => toast.error(String(e)),
    onSettled: invalidate,
  });
}
