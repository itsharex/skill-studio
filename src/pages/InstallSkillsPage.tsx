import { LocalSkillsPanel } from "./LocalSkillsPanel";
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
import type { CatalogSkill } from "@/types";

export function InstallSkillsPage({ onBack }: { onBack?: () => void }) {
  const [mode, setMode] = useState<"local" | "online">("online");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
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
    mutationFn: (skill: CatalogSkill) =>
      skillsApi.installCatalog(skill.source, skill.skillId),
    onMutate: () => setInstallError(null),
    onSuccess: async () => {
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
              ["local", "本地"],
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
          {installError && (
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
                            disabled={done || install.isPending}
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
