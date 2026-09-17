import type { ReactNode } from "react";

/**
 * 设置页的分段标题：一枚蓝色图标加一条下边线，下面挂若干 SettingCard。
 * action 放在标题行右端，用于整段级别的动作（如「添加服务器」）；它在 h3
 * 之外，不会被算进标题的可及名称。
 */
export function SettingsSection({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-border/60 pb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-blue-500 [&>*]:h-5 [&>*]:w-5">{icon}</span>
          {title}
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * 设置页的一张卡：左边图标，中间标题与说明，右边放控件（children）。
 * 需要展开一块输入区或列表时放进 details，会被一条分割线隔在下方。
 */
export function SettingCard({
  title,
  description,
  icon,
  children,
  details,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon: ReactNode;
  children?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border-default bg-card px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-default bg-background text-blue-500 [&>*]:h-5 [&>*]:w-5">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          {description && (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {children && (
          <div className="flex shrink-0 items-center gap-2">{children}</div>
        )}
      </div>
      {details && (
        <div className="mt-4 border-t border-border/60 pt-4">{details}</div>
      )}
    </div>
  );
}
