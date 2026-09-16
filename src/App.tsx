import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  FolderGit2,
  Layers,
  Library,
  Monitor,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/common/AgentIcon";
import { NavSwitcher, type NavSection } from "@/components/common/NavSwitcher";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useAgents, useSkillsAutoRefresh } from "@/hooks/useData";
import { systemApi } from "@/lib/api";
import { isLinux, isWindows } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AgentPage } from "@/pages/AgentPage";
import { GroupsPage } from "@/pages/GroupsPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";

// macOS 把红绿灯悬浮在内容上（titleBarStyle: Overlay），需要让出 28px；
// Windows / Linux 自带或自绘标题栏，不留空。
const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28;
const HEADER_HEIGHT = 64;
const CONTENT_TOP_OFFSET = DRAG_BAR_HEIGHT + HEADER_HEIGHT;

const AGENT_PREFIX = "agent:";
const VIEW_STORAGE_KEY = "skill-studio-view";

type StaticView = "library" | "groups" | "projects" | "settings";
type ViewId = StaticView | `agent:${string}`;

const STATIC_TITLES: Record<StaticView, string> = {
  library: "全局 Skill",
  groups: "分组",
  projects: "项目",
  settings: "设置",
};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: "浅色" },
    { value: "dark", icon: Moon, label: "深色" },
    { value: "system", icon: Monitor, label: "跟随系统" },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-muted p-1">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-xl-inner transition-all duration-200",
            theme === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { data: agents = [] } = useAgents();
  const queryClient = useQueryClient();
  useSkillsAutoRefresh();

  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewId | null;
    // 设置是全屏临时视图（没有侧栏），重启后停在这里没有意义；
    // 旧版本可能已经把它写进过 localStorage，这里一并挡掉。
    return stored && stored !== "settings" ? stored : "library";
  });
  const isSettings = view === "settings";

  // 设置页的返回目标 = 进入设置之前停留的那个视图
  const backTarget = useRef<ViewId>("library");
  useEffect(() => {
    if (view !== "settings") {
      backTarget.current = view;
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  }, [view]);

  // 启动期错误（例如配置文件坏了）要让用户看见，而不是静默用默认值跑
  useEffect(() => {
    void systemApi
      .getInitError()
      .then(setInitError)
      .catch(() => setInitError(null));
  }, []);

  const titles = useMemo(() => {
    const map: Record<string, string> = { ...STATIC_TITLES };
    for (const a of agents) {
      map[`${AGENT_PREFIX}${a.id}`] = a.displayName;
    }
    return map;
  }, [agents]);

  const sections = useMemo<NavSection<ViewId>[]>(
    () => [
      {
        items: [
          {
            id: "library",
            label: STATIC_TITLES.library,
            icon: <Library className="h-4 w-4" />,
          },
        ],
      },
      {
        label: "AGENT",
        items: agents.map((a) => ({
          id: `${AGENT_PREFIX}${a.id}` as ViewId,
          label: a.displayName,
          icon: <AgentIcon agentId={a.id} className="h-4 w-4" />,
          badge: a.detected ? undefined : "未装",
        })),
      },
      {
        label: "组织",
        items: [
          {
            id: "groups",
            label: STATIC_TITLES.groups,
            icon: <Layers className="h-4 w-4" />,
          },
          {
            id: "projects",
            label: STATIC_TITLES.projects,
            icon: <FolderGit2 className="h-4 w-4" />,
          },
        ],
      },
    ],
    [agents],
  );

  /** 当前停留在哪个 agent 页（顶栏要显示它的品牌标记） */
  const activeAgent = view.startsWith(AGENT_PREFIX)
    ? agents.find((a) => a.id === view.slice(AGENT_PREFIX.length))
    : undefined;

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  const content = () => {
    if (view.startsWith(AGENT_PREFIX)) {
      return <AgentPage agentId={view.slice(AGENT_PREFIX.length)} />;
    }
    switch (view) {
      case "groups":
        return <GroupsPage />;
      case "projects":
        return <ProjectsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <LibraryPage />;
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex h-screen flex-col overflow-hidden bg-background text-foreground selection:bg-primary/30"
        style={{ overflowX: "hidden", paddingTop: CONTENT_TOP_OFFSET }}
      >
        {/* ① 顶部拖拽条：macOS 让位给红绿灯 */}
        <div
          data-tauri-drag-region
          className="fixed left-0 right-0 top-0 z-[70] flex items-center justify-end px-2"
          style={{ height: DRAG_BAR_HEIGHT }}
        />

        {/* ② fixed 毛玻璃顶栏 */}
        <header
          data-tauri-drag-region
          className="fixed z-50 w-full bg-background/80 backdrop-blur-md transition-all duration-300"
          style={{ top: DRAG_BAR_HEIGHT, height: HEADER_HEIGHT }}
        >
          <div className="flex h-full items-center justify-between gap-2 px-6">
            <div className="flex items-center gap-2.5" data-tauri-no-drag>
              {isSettings ? (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  title="返回"
                  aria-label="返回"
                  onClick={() => setView(backTarget.current)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : activeAgent ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-card">
                  <AgentIcon
                    agentId={activeAgent.id}
                    className="h-[18px] w-[18px]"
                  />
                </div>
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 shadow-sm">
                  <Layers className="h-[18px] w-[18px] text-white" />
                </div>
              )}
              <h1 className="text-lg font-semibold leading-none">
                {titles[view] ?? "Skill Studio"}
              </h1>
            </div>

            <div className="flex items-center gap-2" data-tauri-no-drag>
              <ThemeToggle />
              <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-8 rounded-xl-inner px-2 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                  title="重新扫描"
                  onClick={refresh}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                {!isSettings && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-8 rounded-xl-inner px-2 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                    title="设置"
                    onClick={() => setView("settings")}
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ③ 侧栏 + 内容区 */}
        <div className="flex min-h-0 flex-1">
          {!isSettings && (
            <nav
              aria-label="主导航"
              className="w-[236px] shrink-0 overflow-y-auto px-3 py-4"
            >
              <NavSwitcher
                sections={sections}
                active={view}
                onSelect={setView}
              />
            </nav>
          )}

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {initError && (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                  <p className="font-medium">配置未能正常加载</p>
                  <p className="pt-0.5 text-muted-foreground">{initError}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInitError(null)}
                >
                  知道了
                </Button>
              </div>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                className="flex min-h-0 flex-1 flex-col overflow-hidden px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {content()}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
