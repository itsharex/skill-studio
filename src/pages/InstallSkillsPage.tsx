import { LocalSkillsPanel } from "./LocalSkillsPanel";
import { useTarget } from "@/components/targets/TargetProvider";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Search,
  Download,
  ExternalLink,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useSkills } from "@/hooks/useData";
import { skillsApi } from "@/lib/api";
import type { CatalogSkill, CatalogCandidate } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function InstallSkillsPage({ onBack }: { onBack?: () => void }) {
  const target = useTarget();
  const [mode, setMode] = useState<"local" | "online">("online");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    skill: CatalogSkill;
    candidates: CatalogCandidate[];
  } | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { data: installed = [] } = useSkills();
  const client = useQueryClient();
  const search = useQuery({
    queryKey: ["catalog", submitted],
    queryFn: () => skillsApi.searchCatalog(submitted),
    enabled: submitted.length >= 2,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const install = useMutation({
    mutationFn: (skill: CatalogSkill & { repositoryPath?: string }) =>
      skillsApi.installCatalog(
        skill.source,
        skill.skillId,
        skill.repositoryPath,
      ),
    onMutate: () => setInstallError(null),
    onSuccess: async (result, skill) => {
      if (result.status === "selectionRequired") {
        setSelection({ skill, candidates: result.candidates });
        setSelectedPath(null);
        return;
      }
      setSelection(null);
      await client.invalidateQueries({ queryKey: ["skills"] });
      toast.success("已安装到 Skill Hub");
    },
    onError: (error) => {
      setInstallError(String(error));
    },
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (Array.from(next).length < 2) return;
    if (next === submitted) void search.refetch();
    else setSubmitted(next);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Dialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open && !install.isPending) {
            setSelection(null);
            setInstallError(null);
          }
        }}
      >
        <DialogContent hideClose={install.isPending}>
          <DialogHeader>
            <DialogTitle>选择 skill 安装来源</DialogTitle>
            <DialogDescription>
              {selection?.skill.name}{" "}
              在仓库中有多个同名版本，请确认要安装的目录。仅安装所选版本到 Skill
              Hub。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto px-6 py-4">
            <p className="break-all text-xs text-muted-foreground">
              {selection?.skill.source}
            </p>
            {selection && (
              <p className="text-sm text-muted-foreground">
                {new Set(
                  selection.candidates.map(
                    (candidate) => candidate.contentHash,
                  ),
                ).size === 1
                  ? "这些目录的文件内容相同，但来源路径不同。"
                  : "这些目录的文件内容不同，可能是针对不同 Agent 的版本。"}
              </p>
            )}
            <fieldset disabled={install.isPending} className="space-y-2">
              <legend className="sr-only">安装目录</legend>
              {selection?.candidates.map((candidate) => (
                <label
                  key={candidate.repositoryPath}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <input
                    type="radio"
                    name="catalog-path"
                    className="mt-1"
                    checked={selectedPath === candidate.repositoryPath}
                    onChange={() => setSelectedPath(candidate.repositoryPath)}
                  />
                  <span className="min-w-0">
                    <span className="block break-all font-mono text-sm">
                      {candidate.repositoryPath || "仓库根目录"}
                    </span>
                    {candidate.description && (
                      <span className="mt-1 block whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {candidate.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            {installError && (
              <p role="alert" className="text-sm text-destructive">
                安装失败：{installError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={install.isPending}
              onClick={() => {
                setSelection(null);
                setInstallError(null);
              }}
            >
              取消
            </Button>
            <Button
              disabled={selectedPath === null || install.isPending}
              onClick={() => {
                if (selection && selectedPath !== null)
                  install.mutate({
                    ...selection.skill,
                    repositoryPath: selectedPath,
                  });
              }}
            >
              {install.isPending ? "安装中…" : "安装所选版本"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {target.id !== "local" && (
        <p className="pt-3 text-sm text-muted-foreground">
          安装到 {target.name} 的 Skill Hub
        </p>
      )}
      {onBack && (
        <div className="pt-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            返回 Skill Hub
          </Button>
        </div>
      )}
      <div className="flex min-h-[72px] items-center gap-3">
        <div
          role="tablist"
          aria-label="安装来源"
          className="flex shrink-0 gap-1 rounded-xl border p-1"
        >
          {(
            [
              ["local", target.id === "local" ? "本地" : "目录 / 上传"],
              ["online", "skills.sh"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              role="tab"
              aria-selected={mode === value}
              variant="ghost"
              className={
                mode === value
                  ? "bg-blue-500 text-white hover:bg-blue-600 hover:text-white"
                  : ""
              }
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {mode === "online" && (
          <form
            onSubmit={submit}
            className="flex min-w-0 flex-1 items-center gap-3 py-4"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索 skills.sh"
                placeholder="搜索 skills.sh（至少 2 个字符）…"
                maxLength={200}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
            <Button
              type="submit"
              disabled={
                Array.from(query.trim()).length < 2 || search.isFetching
              }
              className="h-10 bg-blue-500 text-white hover:bg-blue-600"
            >
              {search.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              搜索技能
            </Button>
          </form>
        )}
      </div>
      {mode === "local" ? (
        <LocalSkillsPanel />
      ) : (
        <>
          {installError && !selection && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              安装失败：{installError}
            </div>
          )}
          <div
            className="min-h-0 flex-1 overflow-y-auto pb-6"
            aria-busy={search.isFetching}
          >
            {!submitted ? (
              <div className="flex flex-col items-center gap-5 py-24 text-muted-foreground">
                <Search className="h-12 w-12 opacity-30" />
                <p className="text-sm">搜索 skills.sh（至少 2 个字符）…</p>
              </div>
            ) : search.isFetching ? (
              <div className="flex justify-center gap-2 py-24 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                正在搜索…
              </div>
            ) : search.isError ? (
              <div role="alert" className="py-16 text-center">
                <p className="mb-3 text-sm text-destructive">
                  搜索失败：{String(search.error)}
                </p>
                <Button variant="outline" onClick={() => void search.refetch()}>
                  重试
                </Button>
              </div>
            ) : !search.data?.length ? (
              <p className="py-24 text-center text-sm text-muted-foreground">
                没有找到匹配的 skill，换个关键词试试。
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  找到 {search.data.length} 个结果
                  {search.data.length === 100 ? "（最多显示前 100 个）" : ""}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {search.data.map((skill) => {
                    const done = installed.some(
                      (s) =>
                        !s.diagnostics?.length &&
                        s.installation?.source === skill.source &&
                        s.installation.skillId === skill.skillId,
                    );
                    const pending =
                      install.isPending &&
                      install.variables?.source === skill.source &&
                      install.variables.skillId === skill.skillId;
                    return (
                      <article
                        key={`${skill.source}/${skill.skillId}`}
                        className="flex min-w-0 flex-col rounded-xl border border-border-default bg-card shadow-sm"
                      >
                        <div className="min-w-0 flex-1 p-5">
                          <h2 className="break-words text-base font-semibold">
                            {skill.name}
                          </h2>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="max-w-full break-all text-[11px]"
                            >
                              {skill.source}
                            </Badge>
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              <Download className="h-3 w-3" />
                              {skill.installs.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 border-t px-5 py-3">
                          <Button
                            variant="ghost"
                            className="flex-1 text-muted-foreground"
                            onClick={() =>
                              void openUrl(
                                `https://skills.sh/${skill.source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(skill.skillId)}`,
                              ).catch((e) => toast.error(String(e)))
                            }
                          >
                            <ExternalLink className="h-4 w-4" />
                            查看
                          </Button>
                          <Button
                            className="flex-1 bg-emerald-500 text-white hover:bg-emerald-600"
                            disabled={
                              done || install.isPending || selection !== null
                            }
                            onClick={() => install.mutate(skill)}
                          >
                            {pending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : done ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            {pending ? "安装中…" : done ? "已安装" : "安装"}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
