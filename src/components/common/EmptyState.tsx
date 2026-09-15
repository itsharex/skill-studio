import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-lg font-medium">{title}</p>
      {description && (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
