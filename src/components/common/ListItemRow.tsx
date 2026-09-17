import { cn } from "@/lib/utils";

/** 所有管理列表的行骨架。分割线由行自己的 border-b 提供。 */
export function ListItemRow({
  children,
  isLast,
  card = false,
  className,
  onClick,
}: {
  children: React.ReactNode;
  isLast?: boolean;
  card?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
        card
          ? "min-h-20 rounded-xl border border-border-default bg-card px-5 py-4"
          : !isLast && "border-b border-border-default",
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
  cards = false,
  className,
}: {
  children: React.ReactNode;
  cards?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        cards
          ? "flex flex-col gap-3"
          : "overflow-hidden rounded-xl border border-border-default",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Hover/focus reveals actions without changing the card's layout. */
export function RowActions({
  children,
  busy = false,
}: {
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <div
      aria-busy={busy}
      className={cn(
        "pointer-events-none flex flex-shrink-0 items-center gap-1 text-muted-foreground opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [&:has([data-state=open])]:pointer-events-auto [&:has([data-state=open])]:opacity-100",
        busy && "opacity-100 [&_button:disabled]:opacity-100",
      )}
    >
      {children}
    </div>
  );
}
