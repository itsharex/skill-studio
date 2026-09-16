import { cn } from "@/lib/utils";
import icon from "@/assets/skill-studio.png";

/** The same Icon Composer artwork used by the application bundle. */
export function SkillStudioIcon({ className }: { className?: string }) {
  return (
    <img
      src={icon}
      className={cn("h-5 w-5 shrink-0 object-contain", className)}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
