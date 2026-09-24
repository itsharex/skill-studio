import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const PageToolsContext = createContext<{
  search: HTMLElement | null;
  add: HTMLElement | null;
} | null>(null);

export function PageTools({
  query,
  onQueryChange,
  placeholder,
  createLabel,
  onCreate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  createLabel: string;
  onCreate: () => void;
}) {
  const hosts = useContext(PageToolsContext);
  const search = (
    <div className={`relative min-w-0 ${hosts ? "w-full" : "w-52 max-w-full"}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="h-9 pl-8 pr-8"
      />
      {query && (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onQueryChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
  const add = (
    <Button
      size="icon"
      title={createLabel}
      aria-label={createLabel}
      onClick={onCreate}
      className="h-9 w-9 shrink-0 rounded-full bg-blue-500 text-white shadow-md shadow-blue-500/20 hover:bg-blue-600"
    >
      <Plus className="h-5 w-5" />
    </Button>
  );
  if (!hosts)
    return (
      <div className="flex justify-end gap-3 py-3">
        {search}
        {add}
      </div>
    );
  return (
    <>
      {hosts.search && createPortal(search, hosts.search)}
      {hosts.add && createPortal(add, hosts.add)}
    </>
  );
}
