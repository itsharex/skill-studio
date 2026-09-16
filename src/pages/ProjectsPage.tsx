import { useQueuedDraft } from "@/hooks/useQueuedDraft";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  FolderGit2,
  FolderOpen,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/common/AgentIcon";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { ListToolbar } from "@/components/common/ListToolbar";
import { projectsApi, systemApi } from "@/lib/api";
import {
  useAgents,
  useApplyProject,
  useCreateProject,
  useDeleteProject,
  useGroups,
  useProjects,
  useSkills,
  useUpdateProject,
  useWriteProjectGitignore,
} from "@/hooks/useData";
import type { LinkMode, ProjectBinding } from "@/types";

export function ProjectsPage() {
  const { data: projects = [] } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectBinding | null>(null);
  const [form, setForm] = useState({ name: "", root: "" });

  const active = projects.find((p) => p.id === detail) ?? null;
  if (active) {
    return (
      <ProjectDetail
        key={active.id}
        project={active}
        onBack={() => setDetail(null)}
      />
    );
  }

  const pick = async () => {
    const picked = await projectsApi.pickDirectory();
    if (!picked) return;
    const base = picked.split(/[/\\]/).filter(Boolean).pop() ?? picked;
    setForm({ root: picked, name: form.name || base });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar
        count={projects.length}
        total={projects.length}
        unit="个项目"
        query=""
        onQueryChange={() => {}}
      >
        <Button
          size="sm"
          onClick={() => {
            setForm({ name: "", root: "" });
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          添加项目
        </Button>
      </ListToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="还没有项目"
            description="绑定一个项目目录，就能让某些 skill 只对这个项目生效。项目级默认用文件复制而不是软链——软链进 git 是一个指向本机绝对路径的死链。"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setForm({ name: "", root: "" });
                  setCreating(true);
                }}
              >
                <Plus className="h-4 w-4" />
                添加项目
              </Button>
            }
          />
        ) : (
          <ListContainer>
            {projects.map((p, i) => (
              <ListItemRow
                key={p.id}
                isLast={i === projects.length - 1}
                onClick={() => setDetail(p.id)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                  <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {p.name}
                    </span>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {p.skillIds.length + p.groupIds.length} 项绑定
                    </Badge>
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {p.linkMode === "copy"
                        ? "复制"
                        : p.linkMode === "symlink"
                          ? "软链"
                          : "自动"}
                    </Badge>
                  </div>
                  <p className="truncate pt-0.5 font-mono text-[11px] text-muted-foreground">
                    {p.root}
                  </p>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="打开项目目录"
                      onClick={() => void systemApi.revealPath(p.root)}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-red-500"
                      title="移除项目"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </RowActions>
                </div>
              </ListItemRow>
            ))}
          </ListContainer>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>
              选一个项目根目录，之后绑定的 skill 只会写进这个项目里。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <Label>项目目录</Label>
              <div className="flex gap-2">
                <Input
                  value={form.root}
                  placeholder="点右侧按钮选择"
                  onChange={(e) => setForm({ ...form, root: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void pick()}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">项目名</Label>
              <Input
                id="proj-name"
                value={form.name}
                placeholder="用于在列表里识别"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreating(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!form.name.trim() || !form.root.trim()}
              onClick={() => {
                createProject.mutate({ name: form.name, root: form.root });
                setCreating(false);
              }}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`移除项目「${deleting?.name}」`}
        confirmText="移除"
        pending={deleteProject.isPending}
        description={
          <>
            只解除绑定，
            <span className="font-medium">
              已写进项目目录的 skill 文件不会被删除
            </span>
            —— 它们可能已经提交进 git 了。
          </>
        }
        onConfirm={() => {
          if (deleting) deleteProject.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function ProjectDetail({
  project,
  onBack,
}: {
  project: ProjectBinding;
  onBack: () => void;
}) {
  const { data: agents = [] } = useAgents();
  const { data: skills = [] } = useSkills();
  const { data: groups = [] } = useGroups();
  const update = useUpdateProject();
  const apply = useApplyProject();
  const gitignore = useWriteProjectGitignore();
  const [query, setQuery] = useState("");
  const [writing, setWriting] = useState(false);

  const remote = useMemo(
    () => ({
      agentIds: project.agentIds,
      skillIds: project.skillIds,
      groupIds: project.groupIds,
      linkMode: project.linkMode,
    }),
    [project.agentIds, project.skillIds, project.groupIds, project.linkMode],
  );
  const draft = useQueuedDraft(remote, (next) =>
    update.mutateAsync({ projectId: project.id, ...next }),
  );

  const projectAgents = useMemo(
    () => agents.filter((a) => a.supportsProjectSkills),
    [agents],
  );

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, query]);

  const toggle = (key: "agentIds" | "skillIds" | "groupIds", id: string) =>
    draft.edit((previous) => ({
      ...previous,
      [key]: previous[key].includes(id)
        ? previous[key].filter((x) => x !== id)
        : [...previous[key], id],
    }));
  const toggleAgent = (id: string) => toggle("agentIds", id);
  const toggleSkill = (id: string) => toggle("skillIds", id);
  const toggleGroup = (id: string) => toggle("groupIds", id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 py-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() =>
            void draft
              .flush()
              .then(onBack)
              .catch(() => {})
          }
          title="返回"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{project.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {project.root}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => gitignore.mutate(project.id)}
        >
          写入 .gitignore
        </Button>
        <Button
          size="sm"
          disabled={
            draft.value.agentIds.length === 0 ||
            (draft.value.skillIds.length === 0 &&
              draft.value.groupIds.length === 0) ||
            writing ||
            apply.isPending
          }
          onClick={() => {
            setWriting(true);
            void draft
              .flush()
              .then(() => apply.mutateAsync(project.id))
              .catch(() => {})
              .finally(() => setWriting(false));
          }}
        >
          <Upload className="h-4 w-4" />
          写入项目
        </Button>
      </div>

      <div role="status" className="text-xs text-muted-foreground">
        {draft.pending
          ? "正在保存选择…"
          : draft.error
            ? `保存失败，选择已保留：${draft.error}`
            : "选择会自动保存"}
        {draft.error && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void draft.flush().catch(() => {})}
          >
            重试保存
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-6">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">生效的 agent</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-[11px] text-muted-foreground">
                  写入位置
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Claude Code 写 <code>.claude/skills</code>， Codex 写{" "}
                <code>.agents/skills</code>（不是 .codex/skills）
              </TooltipContent>
            </Tooltip>
          </div>
          <ListContainer>
            {projectAgents.map((a, i) => (
              <ListItemRow
                key={a.id}
                isLast={i === projectAgents.length - 1}
                onClick={() => toggleAgent(a.id)}
              >
                <Checkbox
                  checked={draft.value.agentIds.includes(a.id)}
                  aria-label={a.displayName}
                />
                <AgentIcon agentId={a.id} className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-medium">
                  {a.displayName}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {a.id === "codex" ? ".agents/skills" : ".claude/skills"}
                </span>
              </ListItemRow>
            ))}
          </ListContainer>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">链接方式</h3>
          <div className="flex items-center gap-3">
            <Select
              value={draft.value.linkMode}
              onValueChange={(v) =>
                draft.edit((previous) => ({
                  ...previous,
                  linkMode: v as LinkMode,
                }))
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">复制（推荐）</SelectItem>
                <SelectItem value="symlink">符号链接</SelectItem>
                <SelectItem value="auto">自动</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              项目 skill 通常要进 git 给团队共享。软链进 git 只是一个指向本机
              绝对路径的文本文件，别人拉下来就是断链，所以默认用复制。
            </p>
          </div>
        </section>

        {groups.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">绑定分组</h3>
            <ListContainer>
              {groups.map((g, i) => (
                <ListItemRow
                  key={g.id}
                  isLast={i === groups.length - 1}
                  onClick={() => toggleGroup(g.id)}
                >
                  <Checkbox
                    checked={draft.value.groupIds.includes(g.id)}
                    aria-label={g.name}
                  />
                  <span className="flex-1 text-sm font-medium">{g.name}</span>
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                    {g.skillIds.length} 个
                  </Badge>
                </ListItemRow>
              ))}
            </ListContainer>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">单独绑定 skill</h3>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 skill…"
          />
          {filteredSkills.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              没有匹配的 skill
            </p>
          ) : (
            <ListContainer>
              {filteredSkills.map((s, i) => (
                <ListItemRow
                  key={s.id}
                  isLast={i === filteredSkills.length - 1}
                  onClick={() => toggleSkill(s.id)}
                >
                  <Checkbox
                    checked={draft.value.skillIds.includes(s.id)}
                    aria-label={s.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    {s.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                  </div>
                </ListItemRow>
              ))}
            </ListContainer>
          )}
        </section>
      </div>
    </div>
  );
}
