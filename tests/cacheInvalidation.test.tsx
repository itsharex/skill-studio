import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { expect, it } from "vitest";
import { useAdoptToHub, useRestoreBackup } from "@/hooks/useData";
import { handlers, makeSkill } from "./mocks/tauri";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
it("invalidates stored config and skill backups after a management write", async () => {
  const { client, wrapper } = setup();
  client.setQueryData(["config"], { old: true });
  client.setQueryData(["skill-backups"], []);
  handlers.set("adopt_to_hub", () => makeSkill());
  const { result } = renderHook(() => useAdoptToHub(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync("skill");
  });
  expect(client.getQueryState(["config"])?.isInvalidated).toBe(true);
  expect(client.getQueryState(["skill-backups"])?.isInvalidated).toBe(true);
  client.clear();
});
it("refreshes agent directory information after restoring configuration", async () => {
  const { client, wrapper } = setup();
  client.setQueryData(["agents"], [{ root: "/old" }]);
  handlers.set("restore_backup", () => ({}));
  const { result } = renderHook(() => useRestoreBackup(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync("/backup.json");
  });
  expect(client.getQueryState(["agents"])?.isInvalidated).toBe(true);
  client.clear();
});
