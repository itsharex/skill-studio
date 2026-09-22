import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FolderGit2, FolderOpen } from "lucide-react";
import { McpAssignments } from "@/components/mcp/McpAssignments";
import { PageTools } from "@/components/common/PageTools";
import {
  ListContainer,
  ListItemRow,
  RowActions,
} from "@/components/common/ListItemRow";
import { EmptyState } from "@/components/common/EmptyState";
import {
  NavigationGuard,
  useNavigationGuard,
} from "@/components/common/NavigationGuard";
import { useTarget } from "@/components/targets/TargetProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useProjects, useCreateProject } from "@/hooks/useData";
import { projectsApi, systemApi } from "@/lib/api";
import { managementApi, rows } from "@/lib/api/mcpManagement";

export function McpProjectsPage() {
  const target = useTarget();
  if (target.id !== "local")
    return (
      <p className="p-6 text-sm text-muted-foreground">
        项目 MCP 当前仅支持本机。请切换到本机管理。
      </p>
    );
  return (
    <NavigationGuard>
      <McpProjectsContent />
    </NavigationGuard>
  );
}
function McpProjectsContent() {
  const requestNavigation = useNavigationGuard();
  const projects = useProjects();
  const status = useQuery({
    queryKey: ["mcp", "local"],
    queryFn: managementApi.list,
    // Keep polling in the background without fetching again on every Agent switch.
    staleTime: 4_000,
    refetchInterval: 4000,
  });
  const create = useCreateProject();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", root: "" });
  const active = projects.data?.find((project) => project.id === detail);
  const catalog = rows(status.data);
  const count = (root: string) =>
    catalog.filter((row) =>
      [...row.sources, ...row.entry.bindings].some(
        (source) =>
          source.project === root ||
          ["/.mcp.json", "/.codex/config.toml"].some(
            (suffix) => source.path === root.replace(/\/+$/, "") + suffix,
          ),
      ),
    ).length;
  const filtered = (projects.data ?? []).filter((project) =>
    `${project.name} ${project.root}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTools
        query={query}
        onQueryChange={(value) =>
          requestNavigation(() => {
            setQuery(value);
            setDetail(null);
          })
        }
        placeholder="搜索项目…"
        createLabel="添加项目"
        onCreate={() =>
          requestNavigation(() => {
            setForm({ name: "", root: "" });
            setCreating(true);
          })
        }
      />
      {active ? (
        <>
          <div className="flex items-center gap-3 py-4">
            <Button
              variant="outline"
              size="icon"
              title="返回"
              onClick={() => requestNavigation(() => setDetail(null))}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{active.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {active.root}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="打开项目目录"
              onClick={() => void systemApi.revealPath(active.root)}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            <McpAssignments key={active.id} project={active} />
          </div>
        </>
      ) : (
        <>
          <div className="my-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default px-5 py-4">
            <p className="text-sm text-muted-foreground">
              管理各项目的 MCP 接入
            </p>
            <Badge variant="outline">
              项目 {projects.data?.length ?? 0} 个
            </Badge>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6">
            {(projects.isPending || status.isPending) && (
              <p className="py-6 text-sm text-muted-foreground">
                正在读取项目 MCP…
              </p>
            )}
            {(projects.error || status.error) && (
              <p role="alert" className="text-sm text-destructive">
                {String(projects.error ?? status.error)}
              </p>
            )}
            {!projects.isPending &&
              !projects.error &&
              !projects.data?.length && (
                <EmptyState
                  icon={FolderGit2}
                  title="还没有项目"
                  description="添加项目目录后，可从 MCP Hub 选择服务，只在该项目中接入。"
                />
              )}
            <ListContainer cards>
              {filtered.map((project) => (
                <ListItemRow
                  key={project.id}
                  card
                  onPreview={() => setDetail(project.id)}
                  previewLabel={`查看 ${project.name} 的 MCP`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <FolderGit2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {project.name}
                      </span>
                      {!status.isPending && !status.error && (
                        <Badge variant="outline">
                          {count(project.root)} 个 MCP
                        </Badge>
                      )}
                    </div>
                    <p className="truncate pt-0.5 text-xs text-muted-foreground">
                      {project.root}
                    </p>
                  </div>
                  <RowActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="打开项目目录"
                      onClick={() => void systemApi.revealPath(project.root)}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </RowActions>
                </ListItemRow>
              ))}
            </ListContainer>
            {!!projects.data?.length && !filtered.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                没有匹配的项目
              </p>
            )}
          </div>
        </>
      )}
      <Dialog
        open={creating}
        onOpenChange={(open) => !create.isPending && setCreating(open)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>
              选择项目根目录，在此项目中配置 MCP。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <label className="block space-y-2 text-sm">
              <span>项目目录</span>
              <div className="flex gap-2">
                <Input
                  aria-label="项目目录"
                  value={form.root}
                  disabled={create.isPending}
                  onChange={(e) => setForm({ ...form, root: e.target.value })}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="选择项目目录"
                  disabled={create.isPending}
                  onClick={async () => {
                    const root = await projectsApi.pickDirectory();
                    if (root)
                      setForm((prev) => ({
                        root,
                        name:
                          prev.name ||
                          root.split(/[/\\]/).filter(Boolean).pop() ||
                          root,
                      }));
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </label>
            <label className="block space-y-2 text-sm">
              <span>项目名</span>
              <Input
                aria-label="项目名"
                value={form.name}
                disabled={create.isPending}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={() => setCreating(false)}
            >
              取消
            </Button>
            <Button
              disabled={
                create.isPending || !form.name.trim() || !form.root.trim()
              }
              onClick={() =>
                create.mutate(form, { onSuccess: () => setCreating(false) })
              }
            >
              {create.isPending ? "添加中…" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
