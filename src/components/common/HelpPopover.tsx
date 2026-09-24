import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Help stays in the toolbar; opening it never moves the page content. */
export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={label}
          title={label}
        >
          <Info aria-hidden="true" className="h-4 w-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-[120] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-popover p-4 text-popover-foreground shadow-md"
        >
          <p className="mb-2 text-sm font-medium">{label}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {children}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
