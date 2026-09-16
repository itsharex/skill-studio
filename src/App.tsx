import { InstallSkillsPage } from "@/pages/InstallSkillsPage";
import { PageToolsContext } from "@/components/common/PageTools";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  FolderGit2,
  Library,
  RefreshCw,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/common/AgentIcon";
import { NavSwitcher, type NavSection } from "@/components/common/NavSwitcher";
import { useAgents, useSkillsAutoRefresh } from "@/hooks/useData";
import { systemApi } from "@/lib/api";
import { isLinux, isWindows } from "@/lib/platform";
import { AgentPage } from "@/pages/AgentGroupsPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { SettingsPage } from "@/pages/SettingsPage";

// macOS 把红绿灯悬浮在内容上（titleBarStyle: Overlay），需要让出 28px；
// Windows / Linux 自带或自绘标题栏，不留空。
const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28;

const AGENT_PREFIX = "agent:";
const VIEW_STORAGE_KEY = "skill-studio-view";

type StaticView = "library" | "projects" | "settings" | "install";
type ViewId = StaticView | `agent:${string}`;

const STATIC_TITLES: Record<StaticView, string> = {
  library: "Skill Hub",
  projects: "项目",
  settings: "设置",
  install: "安装 skill",
};

export default function App() {
  const { data: agents = [] } = useAgents();
  const queryClient = useQueryClient();
  useSkillsAutoRefresh();

  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewId | null;
    // 设置是临时视图，重启后停在这里没有意义；
    // 旧版本可能已经把它写进过 localStorage，这里一并挡掉。
    return stored &&
      (stored === "projects" ||
        stored === "library" ||
        stored.startsWith(AGENT_PREFIX))
      ? stored
      : "library";
  });
  const [searchHost, setSearchHost] = useState<HTMLDivElement | null>(null);
  const [addHost, setAddHost] = useState<HTMLDivElement | null>(null);
  const isSettings = view === "settings";
  const isSubpage = isSettings || view === "install";

  // 设置页的返回目标 = 进入设置之前停留的那个视图
  const backTarget = useRef<ViewId>("library");
  useEffect(() => {
    if (view !== "settings" && view !== "install") {
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
        label: "项目",
        items: [
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

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  const content = () => {
    if (view.startsWith(AGENT_PREFIX)) {
      return <AgentPage key={view} agentId={view.slice(AGENT_PREFIX.length)} />;
    }
    switch (view) {
      case "projects":
        return <ProjectsPage />;
      case "install":
        return <InstallSkillsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <LibraryPage onAdd={() => setView("install")} />;
    }
  };

  return (
    <PageToolsContext.Provider value={{ search: searchHost, add: addHost }}>
      <TooltipProvider delayDuration={300}>
        <div
          className="flex h-screen flex-col overflow-hidden bg-background text-foreground selection:bg-primary/30"
          style={{ overflowX: "hidden", paddingTop: DRAG_BAR_HEIGHT }}
        >
          {/* ① 顶部拖拽条：macOS 让位给红绿灯 */}
          <div
            data-tauri-drag-region
            className="fixed left-0 right-0 top-0 z-[70] flex items-center justify-end px-2"
            style={{ height: DRAG_BAR_HEIGHT }}
          />

          <header
            data-tauri-drag-region
            className="z-50 flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 bg-background px-6 pb-4 pt-5"
          >
            <div
              className="flex h-11 shrink-0 items-center gap-3"
              data-tauri-no-drag
            >
              {isSubpage && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground"
                  title="返回"
                  aria-label="返回"
                  onClick={() => setView(backTarget.current)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <span
                aria-hidden="true"
                className={`whitespace-nowrap text-xl font-semibold leading-7 tracking-tight ${isSubpage ? "text-foreground" : "text-blue-500"}`}
              >
                {isSubpage ? titles[view] : "Skill Studio"}
              </span>
              <h1 className="sr-only">{titles[view] ?? "Skill Studio"}</h1>
              {!isSubpage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  title="设置"
                  aria-label="设置"
                  onClick={() => setView("settings")}
                >
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              )}
              {!isSubpage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  title="重新扫描"
                  aria-label="重新扫描"
                  onClick={refresh}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>
            {!isSubpage && (
              <div
                className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3"
                data-tauri-no-drag
              >
                <div ref={setSearchHost} />
                <nav
                  aria-label="主导航"
                  className="ml-auto max-w-full"
                  data-tauri-no-drag
                >
                  <NavSwitcher
                    sections={sections}
                    active={view}
                    onSelect={setView}
                  />
                </nav>
                <div ref={setAddHost} />
              </div>
            )}
          </header>

          <div className="flex min-h-0 flex-1">
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
              <motion.div
                key={view}
                className="flex min-h-0 flex-1 flex-col overflow-hidden px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                {content()}
              </motion.div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </PageToolsContext.Provider>
  );
}
