import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function useSkillPreview() {
  const [skill, setSkill] = useState<{ name: string; path: string } | null>(
    null,
  );
  const query = useQuery({
    queryKey: ["skill-preview", skill?.path],
    queryFn: () => invoke<string>("read_skill_document", { path: skill!.path }),
    enabled: !!skill,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return {
    previewSkill: (name: string, path: string) => setSkill({ name, path }),
    previewDialog: (
      <Dialog
        open={!!skill}
        onOpenChange={(open) => {
          if (!open) setSkill(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{skill?.name}</DialogTitle>
            <DialogDescription className="break-all">
              {skill?.path}/SKILL.md
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {query.isPending && (
              <p className="text-sm text-muted-foreground">读取中…</p>
            )}
            {query.isError && (
              <p role="alert" className="text-sm text-destructive">
                无法预览：{String(query.error)}
              </p>
            )}
            {query.isSuccess && (
              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
                {query.data || "文件为空"}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    ),
  };
}
