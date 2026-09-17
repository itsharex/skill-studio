import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, RefreshCw, Search, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Hosts = { hosts: string[]; configPath: string };
export function SshHostPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (host: string) => void;
}) {
  const [data, setData] = useState<Hosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const load = async () => {
    onSelect("");
    setLoading(true);
    setError(null);
    try {
      setData(await invoke<Hosts>("list_ssh_hosts"));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const hosts =
    data?.hosts.filter((host) =>
      host.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="搜索 SSH Host"
            placeholder="搜索 SSH Host…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="刷新 SSH 配置"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {data?.configPath ?? "~/.ssh/config"}
      </p>
      {loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取 SSH 配置…
        </div>
      ) : error ? (
        <p role="alert" className="break-words py-4 text-sm text-destructive">
          {error}
        </p>
      ) : hosts.length ? (
        <div
          role="radiogroup"
          aria-label="SSH 服务器"
          className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1"
        >
          {hosts.map((host) => (
            <button
              key={host}
              type="button"
              role="radio"
              aria-checked={selected === host}
              onClick={() => onSelect(host)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm transition-colors ${selected === host ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
            >
              <Server className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 break-all">{host}</span>
              {selected === host && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {data?.hosts.length
            ? "没有匹配的服务器"
            : "未找到服务器，请先在 ~/.ssh/config 添加具体的 Host，再点击刷新。"}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        用户名、端口、密钥和跳板机均沿用 SSH
        配置；需要密码时会在连接过程中提示。
      </p>
    </div>
  );
}
