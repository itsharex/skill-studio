import { useState } from "react";
import { SettingCard } from "@/components/common/SettingCard";
import {
  Link2,
  Terminal,
  List,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { McpChoiceCards } from "./McpChoiceCards";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Definition } from "@/lib/api/mcpManagement";

export function readDefinition(raw: string): {
  definition: Definition;
  error: string;
} {
  try {
    const definition = JSON.parse(raw);
    if (
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition)
    )
      throw new Error();
    return { definition, error: "" };
  } catch {
    return { definition: {}, error: "配置必须为有效的 JSON 对象" };
  }
}
export function McpDefinitionFields({
  raw,
  setRaw,
}: {
  raw: string;
  setRaw: (raw: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { definition, error } = readDefinition(raw);
  const local = definition.type === "stdio";
  const args = Array.isArray(definition.args)
    ? (definition.args as string[])
    : [];
  function update(patch: Definition) {
    setRaw(JSON.stringify({ ...definition, ...patch }, null, 2));
  }
  return (
    <>
      <McpChoiceCards
        label="服务类型"
        value={String(definition.type ?? "stdio")}
        disabled={!!error}
        options={[
          {
            value: "http",
            title: "HTTP 地址",
            description: "通过网址连接远程 MCP 服务。",
          },
          {
            value: "stdio",
            title: "本地进程",
            description: "通过命令启动本机 MCP 服务。",
          },
          {
            value: "sse",
            title: "SSE 地址",
            description: "连接 SSE 服务，仅支持 Agent 直连。",
          },
        ]}
        onChange={(type) => {
          const value: Definition = {
            ...definition,
            type: type,
          };
          if (type === "stdio") {
            delete value.url;
            delete value.headers;
            value.command ??= "";
          } else {
            delete value.command;
            delete value.args;
            delete value.env;
            delete value.cwd;
            value.url ??= "";
          }
          setRaw(JSON.stringify(value, null, 2));
        }}
      />
      <SettingCard
        compact
        icon={local ? <Terminal /> : <Link2 />}
        title={
          <Label htmlFor="mcp-endpoint">
            {local ? "启动命令" : "MCP 地址"}
          </Label>
        }
        description={
          local
            ? "启动本地 MCP 的可执行文件或命令。"
            : "服务提供的 MCP 连接地址。"
        }
      >
        <Input
          className="w-52 sm:w-80"
          id="mcp-endpoint"
          required
          disabled={!!error}
          value={String((local ? definition.command : definition.url) ?? "")}
          placeholder={
            local ? "npx / uvx / 可执行文件路径" : "https://example.com/mcp"
          }
          onChange={(e) =>
            update({ [local ? "command" : "url"]: e.target.value })
          }
        />{" "}
      </SettingCard>
      {local && (
        <SettingCard
          compact
          icon={<Terminal />}
          title="启动参数"
          description="每项参数单独一行，按顺序传给启动命令。"
          details={
            <div className="space-y-2">
              {args.map((arg, i) => (
                <div className="flex gap-2" key={i}>
                  <Input
                    aria-label={`参数 ${i + 1}`}
                    value={arg}
                    onChange={(e) =>
                      update({
                        args: args.map((x, j) =>
                          j === i ? e.target.value : x,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除参数 ${i + 1}`}
                    onClick={() =>
                      update({ args: args.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!error}
                onClick={() => update({ args: [...args, ""] })}
              >
                <Plus className="h-4 w-4" />
                添加参数
              </Button>
            </div>
          }
        />
      )}
      <Pairs
        label={local ? "环境变量" : "请求头"}
        value={definition[local ? "env" : "headers"]}
        disabled={!!error}
        onChange={(value) => update({ [local ? "env" : "headers"]: value })}
      />
      <SettingCard
        compact
        icon={<SlidersHorizontal />}
        title="高级设置与完整配置"
        description="按需调整工作目录和扩展字段。"
        details={
          expanded && (
            <div className="space-y-3">
              {local && (
                <>
                  <Label htmlFor="mcp-cwd">工作目录</Label>
                  <Input
                    id="mcp-cwd"
                    value={String(definition.cwd ?? "")}
                    disabled={!!error}
                    onChange={(e) => {
                      const next = { ...definition };
                      if (e.target.value) next.cwd = e.target.value;
                      else delete next.cwd;
                      setRaw(JSON.stringify(next, null, 2));
                    }}
                  />
                </>
              )}
              <Label htmlFor="mcp-full-config">完整配置（JSON）</Label>
              <textarea
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                id="mcp-full-config"
                className="h-40 w-full rounded-md border border-border-default bg-background p-3 font-mono text-xs"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                保留超时、工具过滤等扩展字段。跨 Agent 使用时，由目标 Agent
                决定是否支持这些字段。
              </p>
            </div>
          )
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起" : "展开"}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </Button>
      </SettingCard>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
function Pairs({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: Record<string, string>) => void;
}) {
  const pairs =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, string>)
      : [];
  function change(index: number, key: string, text: string) {
    if (pairs.some(([k], i) => i !== index && k === key)) {
      toast.error("键名不能重复");
      return;
    }
    onChange(
      Object.fromEntries(
        pairs.map(([k, v], i) => (i === index ? [key, text] : [k, v])),
      ),
    );
  }
  return (
    <SettingCard
      compact
      icon={<List />}
      title={label}
      description={
        label === "请求头"
          ? "按需添加，例如 Authorization；无需设置可留空。"
          : "按需添加环境变量，无需设置可留空。"
      }
      details={
        pairs.length > 0 && (
          <div className="space-y-3">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5rem] gap-3 text-xs text-muted-foreground sm:grid"
            >
              <span>名称</span>
              <span>值</span>
              <span className="text-right">操作</span>
            </div>
            {pairs.map(([key, value], i) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_5rem] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_5rem]"
                key={i}
              >
                <Input
                  className="col-start-1 row-start-1 min-w-0 text-left"
                  required
                  disabled={disabled}
                  aria-label={`${label}名称 ${i + 1}`}
                  value={key}
                  placeholder={
                    label === "请求头"
                      ? "名称，如 Authorization"
                      : "名称，如 API_KEY"
                  }
                  onChange={(e) => change(i, e.target.value, value)}
                />
                <Input
                  className="col-start-1 row-start-2 min-w-0 text-left sm:col-start-2 sm:row-start-1"
                  disabled={disabled}
                  aria-label={`${label}值 ${i + 1}`}
                  value={value}
                  placeholder={
                    label === "请求头" ? "值，如 Bearer your-token" : "变量值"
                  }
                  onChange={(e) => change(i, key, e.target.value)}
                />
                <Button
                  className="col-start-2 row-start-1 w-full sm:col-start-3"
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-label={`删除${label} ${i + 1}`}
                  onClick={() =>
                    onChange(
                      Object.fromEntries(pairs.filter((_, j) => j !== i)),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </Button>
              </div>
            ))}
          </div>
        )
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pairs.some(([key]) => !key.trim())}
        onClick={() => onChange(Object.fromEntries([...pairs, ["", ""]]))}
      >
        <Plus className="h-4 w-4" />
        添加{label}
      </Button>
    </SettingCard>
  );
}
