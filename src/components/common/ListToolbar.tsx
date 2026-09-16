import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 列表页顶部：计数 + 搜索 + 右侧操作 */
export function ListToolbar({
  count,
  total,
  unit = "个",
  query,
  onQueryChange,
  placeholder = "搜索…",
  children,
  className,
  hideSearch = false,
}: {
  count: number;
  total: number;
  unit?: string;
  query: string;
  onQueryChange: (v: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
  className?: string;
  hideSearch?: boolean;
}) {
  const filtered = query.trim().length > 0 && count !== total;
  return (
    <div className={cn("flex items-center gap-3 py-4", className)}>
      <p className="shrink-0 text-sm text-muted-foreground">
        {filtered ? (
          <>
            <span className="font-medium text-foreground">{count}</span> /{" "}
            {total} {unit}
          </>
        ) : (
          <>
            共 <span className="font-medium text-foreground">{total}</span>{" "}
            {unit}
          </>
        )}
      </p>
      {!hideSearch && (
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            className="pl-8 pr-8"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
