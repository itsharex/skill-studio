import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    spellCheck={false}
    className={cn(
      "flex min-h-[72px] w-full rounded-md border border-border-default bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors",
      "placeholder:text-muted-foreground focus-visible:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 focus:border-border-active",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
