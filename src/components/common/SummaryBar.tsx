import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared geometry for Hub, Agent and project overviews in both resource modes. */
export const summaryPillClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0 text-xs font-medium leading-4";
export const summaryTabClass = "h-7 shrink-0 py-0 text-xs leading-4";

export function SummaryBar({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 flex h-16 w-full shrink-0 items-center gap-3 rounded-xl border border-border-default px-4">
      {children}
    </div>
  );
}

export function SummaryStart({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

export function SummaryEnd({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap border-l border-border-default pl-3",
        className,
      )}
      {...props}
    />
  );
}
