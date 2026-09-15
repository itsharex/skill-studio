import { cn } from "@/lib/utils";

/** 所有管理列表的行骨架。分割线由行自己的 border-b 提供。 */
export function ListItemRow({
  children,
  isLast,
  className,
  onClick,
}: {
  children: React.ReactNode;
  isLast?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
        !isLast && "border-b border-border-default",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 列表外框。圆角 + 边框 + overflow-hidden，让首末行的圆角贴合。 */
export function ListContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border-default",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 行内操作区：默认隐藏，hover 出现 */
export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {children}
    </div>
  );
}
