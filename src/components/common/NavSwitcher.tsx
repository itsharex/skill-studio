import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** 右侧计数徽标，例如该 agent 已注册的 skill 数 */
  badge?: string;
}

export interface NavSection<T extends string> {
  label?: string;
  items: NavItem<T>[];
}

interface NavSwitcherProps<T extends string> {
  sections: NavSection<T>[];
  active: T;
  onSelect: (id: T) => void;
}

/**
 * 竖版分段导航。视觉沿用 cc-switch 顶栏 AppSwitcher 的语言：
 * **每个分区各自一个 `bg-muted` 圆角外框**，每项是框内的一个方块，
 * 选中项用 `bg-background` + `shadow-sm` 浮起来。分区标题放在框外。
 */
export function NavSwitcher<T extends string>({
  sections,
  active,
  onSelect,
}: NavSwitcherProps<T>) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, i) => (
        <div key={section.label ?? i} className="flex flex-col gap-1.5">
          {section.label && (
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </p>
          )}
          <div className="flex flex-col gap-1 rounded-xl bg-muted p-1">
            {section.items.map(({ id, label, icon: Icon, badge }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group inline-flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {label}
                  </span>
                  {badge && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
