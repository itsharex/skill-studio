import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";

/** 每个用例一个全新 QueryClient，避免用例间缓存串味 */
export function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
