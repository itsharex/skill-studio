import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
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

/** Compact, grouped navigation in the window toolbar. */
export function NavSwitcher<T extends string>({
  sections,
  active,
  onSelect,
}: NavSwitcherProps<T>) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section, i) => (
          <div
            key={section.label ?? i}
            role="group"
            aria-label={section.label ?? "Skill 库"}
            className="flex items-center gap-1 rounded-xl bg-muted p-1"
          >
            {section.items.map(({ id, label, icon, badge }) => {
              const isActive = active === id;
              const description = badge ? `${label} · ${badge}` : label;
              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      aria-label={description}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-xl-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 items-center justify-center"
                      >
                        {icon}
                      </span>
                      <span className="sr-only">{description}</span>
                      {badge && (
                        <span
                          aria-hidden="true"
                          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500"
                        />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{description}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
    </div>
  );
}
