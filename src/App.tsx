import { AgentMcpGroups } from "@/pages/AgentMcpGroups";
import { McpProjectsPage } from "@/pages/McpProjectsPage";
import {
  TargetPicker,
  useTarget,
  useTargetConnecting,
} from "@/components/targets/TargetProvider";
import { SkillStudioIcon } from "@/components/common/SkillStudioIcon";
import {
  NavigationGuard,
  useNavigationGuard,
} from "@/components/common/NavigationGuard";
import { InstallSkillsPage } from "@/pages/InstallSkillsPage";
import { PageToolsContext } from "@/components/common/PageTools";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  Plug,
  ArrowLeft,
  FolderGit2,
  Layers,
  RefreshCw,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentIcon } from "@/components/common/AgentIcon";
import { NavSwitcher, type NavSection } from "@/components/common/NavSwitcher";
import { useAgents, useSettings, useSkillsAutoRefresh } from "@/hooks/useData";
import { systemApi } from "@/lib/api";
import { isLinux, isWindows } from "@/lib/platform";
import { AgentPage } from "@/pages/AgentGroupsPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { McpPage, mcpEditorTitle, type McpEditorState } from "@/pages/McpPage";
import { SettingsPage } from "@/pages/SettingsPage";

// macOS 把红绿灯悬浮在内容上（titleBarStyle: Overlay），需要让出 28px；
// Windows / Linux 自带或自绘标题栏，不留空。
const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28;

const AGENT_PREFIX = "agent:";
const VIEW_STORAGE_KEY = "skill-studio-view";

type StaticView = "mcp" | "library" | "projects" | "settings" | "install";
type ViewId = StaticView | `agent:${string}`;

const STATIC_TITLES: Record<StaticView, string> = {
  mcp: "MCP Hub",
  library: "Skill Hub",
  projects: "项目",
  settings: "设置",
  install: "安装 skill",
};

export default function App() {
  return (
    <NavigationGuard>
      <AppContent />
    </NavigationGuard>
  );
}
function AppContent() {
  const reduceMotion = useReducedMotion();
  const target = useTarget();
  const connecting = useTargetConnecting();
  const requestNavigation = useNavigationGuard();
  const { data: allAgents = [] } = useAgents();
  const { data: settings } = useSettings();
  const mcpEnabled = settings ? settings.manageMcp !== false : false;
  const agents = useMemo(
    () => allAgents.filter((a) => !settings?.disabledAgents?.includes(a.id)),
    [allAgents, settings?.disabledAgents],
  );
  const queryClient = useQueryClient();
  useSkillsAutoRefresh();

  const [initError, setInitError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewId | null;
    // 设置是临时视图，重启后停在这里没有意义；
    // 旧版本可能已经把它写进过 localStorage，这里一并挡掉。
    return stored &&
      (stored === "mcp" ||
        stored === "projects" ||
        stored === "library" ||
        stored.startsWith(AGENT_PREFIX))
      ? stored
      : "library";
  });
  const [resource, setResource] = useState<"skills" | "mcp">(() =>
    view === "mcp"
      ? "mcp"
      : view === "library"
        ? "skills"
        : localStorage.getItem("skill-studio-resource") === "mcp"
          ? "mcp"
          : "skills",
  );
  const activeResource = mcpEnabled ? resource : "skills";
  useEffect(() => {
    localStorage.setItem("skill-studio-resource", resource);
  }, [resource]);
  const [hubSlide, setHubSlide] = useState(0);
  const [searchHost, setSearchHost] = useState<HTMLDivElement | null>(null);
  const [addHost, setAddHost] = useState<HTMLDivElement | null>(null);
  const [mcpEditor, setMcpEditor] = useState<McpEditorState | null>(null);
  useEffect(() => setMcpEditor(null), [target.id]);
  const activeMcpEditor =
    mcpEnabled && view === "mcp" && target.id === "local" ? mcpEditor : null;
  const isSettings = view === "settings";
  const isSubpage = isSettings || view === "install" || !!activeMcpEditor;

  // 设置页的返回目标 = 进入设置之前停留的那个视图
  const backTarget = useRef<ViewId>("library");
  useEffect(() => {
    if (settings?.manageMcp !== false) return;
    setResource("skills");
    setMcpEditor(null);
    if (backTarget.current === "mcp") backTarget.current = "library";
    if (view === "mcp") setView("library");
  }, [settings?.manageMcp, view]);
  useEffect(() => {
    if (view !== "settings" && view !== "install") {
      backTarget.current = view;
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
  }, [view]);

  useEffect(() => {
    const disabledView = (id: ViewId) =>
      id.startsWith(AGENT_PREFIX) &&
      (settings?.disabledAgents?.includes(id.slice(AGENT_PREFIX.length)) ||
        (activeResource === "mcp" &&
          !["claude-code", "codex"].includes(id.slice(AGENT_PREFIX.length))));
    const hub = activeResource === "mcp" ? "mcp" : "library";
    if (disabledView(backTarget.current)) backTarget.current = hub;
    if (disabledView(view)) setView(hub);
  }, [settings?.disabledAgents, view, activeResource]);

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
            icon: <Layers className="h-5 w-5" />,
          },
          ...(mcpEnabled
            ? [
                {
                  id: "mcp" as ViewId,
                  label: "MCP Hub",
                  icon: <Plug className="h-5 w-5" />,
                },
              ]
            : []),
        ],
      },
      {
        label: "AGENT",
        items: agents
          .filter(
            (a) =>
              activeResource === "skills" ||
              ["claude-code", "codex"].includes(a.id),
          )
          .map((a) => ({
            id: `${AGENT_PREFIX}${a.id}` as ViewId,
            label: a.displayName,
            icon: <AgentIcon agentId={a.id} className="h-5 w-5" />,
            badge: a.detected ? undefined : "未装",
          })),
      },
      {
        label: "项目",
        items: [
          {
            id: "projects",
            label: STATIC_TITLES.projects,
            icon: <FolderGit2 className="h-5 w-5" />,
          },
        ],
      },
    ],
    [agents, activeResource, mcpEnabled],
  );

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  const content = () => {
    if (view.startsWith(AGENT_PREFIX)) {
      return activeResource === "mcp" ? (
        <AgentMcpGroups key={view} agentId={view.slice(AGENT_PREFIX.length)} />
      ) : (
        <AgentPage key={view} agentId={view.slice(AGENT_PREFIX.length)} />
      );
    }
    switch (view) {
      case "mcp":
        return mcpEnabled ? (
          <McpPage editor={mcpEditor} onEditorChange={setMcpEditor} />
        ) : (
          <LibraryPage
            onAdd={() => requestNavigation(() => setView("install"))}
          />
        );
      case "projects":
        return activeResource === "mcp" ? (
          <McpProjectsPage />
        ) : (
          <ProjectsPage />
        );
      case "install":
        return <InstallSkillsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return (
          <LibraryPage
            onAdd={() => requestNavigation(() => setView("install"))}
          />
        );
    }
  };

  return (
    <PageToolsContext.Provider value={{ search: searchHost, add: addHost }}>
      <TooltipProvider delayDuration={300}>
        <div
          {...(connecting ? { inert: "" } : {})}
          aria-busy={connecting}
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
            className={`z-50 shrink-0 gap-y-3 bg-background px-6 pb-4 pt-5 ${
              isSubpage
                ? "flex items-start justify-between gap-x-6"
                : "grid grid-cols-[auto_minmax(8rem,1fr)_auto_auto] items-center gap-x-3"
            }`}
          >
            <div
              className={`flex min-h-11 min-w-0 items-center gap-3 ${isSettings ? "flex-1" : "col-start-1 row-start-1"}`}
              data-tauri-no-drag
            >
              {isSubpage && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl text-muted-foreground"
                  title="返回"
                  aria-label="返回"
                  onClick={() =>
                    requestNavigation(() =>
                      activeMcpEditor
                        ? setMcpEditor(null)
                        : setView(backTarget.current),
                    )
                  }
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              {!isSubpage && <SkillStudioIcon className="h-8 w-8" />}
              <span
                aria-hidden="true"
                className={`whitespace-nowrap text-xl font-semibold leading-7 tracking-tight ${isSubpage ? "text-foreground" : "text-blue-500"}`}
              >
                {isSubpage
                  ? activeMcpEditor
                    ? mcpEditorTitle(activeMcpEditor)
                    : titles[view]
                  : import.meta.env.DEV
                    ? "Skill Studio Debug"
                    : "Skill Studio"}
              </span>
              <h1 className="sr-only">
                {activeMcpEditor
                  ? mcpEditorTitle(activeMcpEditor)
                  : (titles[view] ?? "Skill Studio")}
              </h1>
              {!isSubpage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  title="设置"
                  aria-label="设置"
                  onClick={() => requestNavigation(() => setView("settings"))}
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
              <TargetPicker />
              {isSettings && (
                <motion.p
                  layout="position"
                  transition={{
                    duration: reduceMotion ? 0 : 0.2,
                    ease: "easeOut",
                  }}
                  className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground"
                >
                  当前管理目标：{target.name} ·
                  目录、管理策略与备份属于此目标；外观与服务器连接属于桌面应用。
                </motion.p>
              )}
            </div>
            {!isSubpage && (
              <>
                <div
                  ref={setSearchHost}
                  className="col-start-2 row-start-1 w-full min-w-0 max-w-52 justify-self-end"
                  data-tauri-no-drag
                />
                <nav
                  aria-label="主导航"
                  className="col-start-3 row-start-1 min-w-0"
                  data-tauri-no-drag
                >
                  <NavSwitcher
                    sections={sections}
                    active={view}
                    selected={activeResource === "mcp" ? "mcp" : "library"}
                    onSelect={(next) => {
                      if (next !== view)
                        requestNavigation(() => {
                          const nextResource =
                            next === "mcp" && mcpEnabled
                              ? "mcp"
                              : next === "library"
                                ? "skills"
                                : resource;
                          setHubSlide(
                            nextResource !== resource
                              ? nextResource === "mcp"
                                ? 14
                                : -14
                              : 0,
                          );
                          if (
                            next === "library" ||
                            (next === "mcp" && mcpEnabled)
                          )
                            setResource(next === "mcp" ? "mcp" : "skills");
                          setView(next);
                        });
                    }}
                  />
                </nav>
                <div
                  ref={setAddHost}
                  className="col-start-4 row-start-1 justify-self-end"
                  data-tauri-no-drag
                />
              </>
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
              <fieldset
                disabled={!target.connected && !isSettings}
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${!target.connected && !isSettings ? "pointer-events-none opacity-60" : ""}`}
              >
                <motion.div
                  key={
                    view.startsWith(AGENT_PREFIX)
                      ? `agent:${activeResource}`
                      : view
                  }
                  className="flex min-h-0 flex-1 flex-col overflow-hidden px-6"
                  initial={reduceMotion ? false : { opacity: 0, x: hubSlide }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.22,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {content()}
                </motion.div>
              </fieldset>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </PageToolsContext.Provider>
  );
}
