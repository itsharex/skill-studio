import { buttonVariants } from "@/components/ui/button";
import { SettingsSection } from "@/components/common/SettingCard";
import {
  Globe,
  Terminal,
  Radio,
  User,
  FolderOpen,
  LockKeyhole,
  Network,
  Plug,
  Settings2,
} from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

export function McpChoiceCards<T extends string>({
  label,
  icon,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: T;
  options: { value: T; title: string; description: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const name = useId();
  const icons: Record<string, typeof Globe> = {
    http: Globe,
    stdio: Terminal,
    sse: Radio,
    user: User,
    project: FolderOpen,
    local: LockKeyhole,
    direct: Plug,
    gateway: Network,
  };

  return (
    <fieldset
      aria-label={label}
      disabled={disabled}
      className="min-w-0 space-y-3"
    >
      <SettingsSection title={label} icon={icon}>
        <div className="flex flex-wrap gap-2 rounded-xl border border-border-default bg-card p-2">
          {options.map((option) => {
            const Icon = icons[option.value] ?? Settings2;
            return (
              <label
                key={option.value}
                className="relative cursor-pointer rounded-lg focus-within:ring-2 focus-within:ring-blue-500/40"
              >
                <input
                  type="radio"
                  name={name}
                  aria-label={`${option.title} ${option.description}`}
                  className="peer sr-only"
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                />
                <span
                  className={buttonVariants({
                    variant: value === option.value ? "default" : "ghost",
                    className:
                      "peer-disabled:pointer-events-none peer-disabled:opacity-50",
                  })}
                >
                  <Icon className="h-4 w-4" />
                  {option.title}
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {options.find((option) => option.value === value)?.description}
        </p>
      </SettingsSection>
    </fieldset>
  );
}
