import { useEffect, useState } from "react";
import { FolderOpen, History, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentIcon } from "@/components/common/AgentIcon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ListContainer, ListItemRow } from "@/components/common/ListItemRow";
import { projectsApi, settingsApi, systemApi } from "@/lib/api";
import {
  useAgents,
  useAppVersion,
  useBackups,
  usePrune,
  useRestoreBackup,
  useSettings,
  useUpdateSettings,
} from "@/hooks/useData";
import type { LinkMode } from "@/types";

type SettingsTab = "general" | "directories" | "maintenance" | "about";

/**
 * 设置页。布局对齐 cc-switch：上方一条分段标签栏、下方内容区，**没有侧栏**
 * —— 侧栏由 App 在这个视图里收起，靠顶栏的返回键退出。
 */
export function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: agents = [] } = useAgents();
  const { data: backups = [] } = useBackups();
  const { data: version } = useAppVersion();
  const update = useUpdateSettings();
  const restore = useRestoreBackup();
  const prune = usePrune();

  const [tab, setTab] = useState<SettingsTab>("general");
  const [restoring, setRestoring] = useState<string | null>(null);
  const [configDir, setConfigDir] = useState<string>("");

  // 配置目录只需取一次；放在渲染体里会每次渲染都发起调用
  useEffect(() => {
    void settingsApi.getConfigDir().then(setConfigDir);
  }, []);

  if (!settings) return null;

  const pickAgentDir = async (agentId: string) => {
    const picked = await projectsApi.pickDirectory();
    if (!picked) return;
    update.mutate({
      agentDirOverrides: { ...settings.agentDirOverrides, [agentId]: picked },
    });
  };

  const clearAgentDir = (agentId: string) => {
    const next = { ...settings.agentDirOverrides };
    delete next[agentId];
    update.mutate({ agentDirOverrides: next });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-4">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SettingsTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="glass mb-5 grid w-full grid-cols-4">
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="directories">目录</TabsTrigger>
          <TabsTrigger value="maintenance">维护</TabsTrigger>
          <TabsTrigger value="about">关于</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <TabsContent value="general" className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">默认链接方式</h3>
              <div className="flex items-start gap-3">
                <Select
                  value={settings.defaultLinkMode}
                  onValueChange={(v) =>
                    update.mutate({ defaultLinkMode: v as LinkMode })
                  }
                >
                  <SelectTrigger className="w-48 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动（优先软链）</SelectItem>
                    <SelectItem value="symlink">符号链接</SelectItem>
                    <SelectItem value="copy">文件复制</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  软链改一处全生效、不占空间；复制各 agent
                  互不影响，但源变更后需要重新复制。 自动模式在软链失败时（例如
                  Windows 未开开发者模式）会自动回退为复制。
                  <span className="block pt-1">
                    项目级 skill 有自己的设置，默认复制。
                  </span>
                </p>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="directories" className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Agent 目录覆盖</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                默认按环境变量（<code>CLAUDE_CONFIG_DIR</code> /{" "}
                <code>CODEX_HOME</code>） 或标准位置解析。如果这些变量只写在
                shell 配置里、图形界面进程读不到， 可以在这里显式指定 ——
                这里的设置优先级最高。
              </p>
              <ListContainer>
                {agents.map((a, i) => {
                  const override = settings.agentDirOverrides[a.id];
                  return (
                    <ListItemRow key={a.id} isLast={i === agents.length - 1}>
                      <AgentIcon
                        agentId={a.id}
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{a.displayName}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {override ?? a.configDir}
                          {!override && (
                            <span className="pl-1 font-sans">（默认）</span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void pickAgentDir(a.id)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        选择
                      </Button>
                      {override && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => clearAgentDir(a.id)}
                        >
                          恢复默认
                        </Button>
                      )}
                    </ListItemRow>
                  );
                })}
              </ListContainer>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Hub 目录</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                收编到 Hub 的 skill 真身存放位置。留空则用默认的{" "}
                <code>~/.skill-studio/skills</code>。Hub 目录不能与任何 agent 的
                skills 目录重叠，否则同步会自我覆盖。
              </p>
              <div className="flex gap-2">
                <Input
                  value={settings.hubDir ?? ""}
                  placeholder="~/.skill-studio/skills（默认）"
                  onChange={(e) =>
                    update.mutate(
                      e.target.value.trim()
                        ? { hubDir: e.target.value }
                        : { clearHubDir: true },
                    )
                  }
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const picked = await projectsApi.pickDirectory();
                    if (picked) update.mutate({ hubDir: picked });
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">配置目录</h3>
              <ListContainer>
                <ListItemRow isLast>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Skill Studio 自己的配置
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {configDir}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!configDir}
                    onClick={() => void systemApi.revealPath(configDir)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    打开
                  </Button>
                </ListItemRow>
              </ListContainer>
            </section>
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">维护</h3>
              <ListContainer>
                <ListItemRow>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">清理失效引用</p>
                    <p className="text-xs text-muted-foreground">
                      skill 真身被删掉后，分组成员与注册记录里会留下悬空引用
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={prune.isPending}
                    onClick={() => prune.mutate()}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    清理
                  </Button>
                </ListItemRow>
                <ListItemRow isLast>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">配置备份保留份数</p>
                    <p className="text-xs text-muted-foreground">
                      每次写入前先备份，超出份数自动清理最旧的
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.backupKeep}
                    className="w-20"
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) {
                        update.mutate({ backupKeep: n });
                      }
                    }}
                  />
                </ListItemRow>
              </ListContainer>
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">配置备份</h3>
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                  {backups.length}
                </Badge>
              </div>
              {backups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  还没有备份。第二次写入配置时会产生第一份。
                </p>
              ) : (
                <ListContainer>
                  {backups.slice(0, 10).map((path, i) => (
                    <ListItemRow
                      key={path}
                      isLast={i === Math.min(backups.length, 10) - 1}
                    >
                      <History className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {path.split(/[/\\]/).pop()}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRestoring(path)}
                      >
                        恢复
                      </Button>
                    </ListItemRow>
                  ))}
                </ListContainer>
              )}
            </section>
          </TabsContent>

          <TabsContent value="about" className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                Skill Studio {version ? `v${version}` : ""}
              </h3>
              <p className="text-xs text-muted-foreground">
                跨 agent 的 Agent Skill 管理器
              </p>
            </div>
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              停用 skill 走各 agent 自己的配置开关（Claude 的{" "}
              <code>skillOverrides</code>、Codex 的{" "}
              <code>[[skills.config]]</code>
              ）， 不删文件，随时可恢复。
            </p>
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              分组是一次性应用（添加 / 移除），不做持续对账 ——
              永远不会误删你手动放进 agent 目录的 skill。
            </p>
          </TabsContent>
        </div>
      </Tabs>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        variant="info"
        title="从备份恢复配置"
        confirmText="恢复"
        pending={restore.isPending}
        description={
          <>
            会用这份备份替换当前的分组、项目与注册记录。
            <span className="font-medium">
              恢复前会先把当前状态另存一份备份
            </span>
            ，所以这一步可以再退回来。已注册的文件不受影响。
          </>
        }
        onConfirm={() => {
          if (restoring) restore.mutate(restoring);
          setRestoring(null);
        }}
      />
    </div>
  );
}
