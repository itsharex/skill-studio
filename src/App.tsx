import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  FolderGit2,
  Layers,
  Library,
  Monitor,
  Moon,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavSwitcher, type NavSection } from "@/components/common/NavSwitcher";
import { useTheme, type Theme } from "@/components/theme-provider";
import { isLinux, isWindows } from "@/lib/platform";
import { cn } from "@/lib/utils";

// macOS 把红绿灯悬浮在内容上（titleBarStyle: Overlay），需要让出 28px；
// Windows / Linux 自带或自绘标题栏，不留空。
const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28;
const HEADER_HEIGHT = 64;
const CONTENT_TOP_OFFSET = DRAG_BAR_HEIGHT + HEADER_HEIGHT;

type ViewId =
  | "library"
  | "agent:claude-code"
  | "agent:codex"
  | "groups"
  | "projects"
  | "settings";

const VIEW_TITLES: Record<ViewId, string> = {
  library: "全局 Skill",
  "agent:claude-code": "Claude Code",
  "agent:codex": "Codex",
  groups: "分组",
  projects: "项目",
  settings: "设置",
};

const NAV_SECTIONS: NavSection<ViewId>[] = [
  { items: [{ id: "library", label: VIEW_TITLES.library, icon: Library }] },
  {
    label: "AGENT",
    items: [
      {
        id: "agent:claude-code",
        label: VIEW_TITLES["agent:claude-code"],
        icon: Boxes,
      },
      { id: "agent:codex", label: VIEW_TITLES["agent:codex"], icon: Boxes },
    ],
  },
  {
    label: "组织",
    items: [
      { id: "groups", label: VIEW_TITLES.groups, icon: Layers },
      { id: "projects", label: VIEW_TITLES.projects, icon: FolderGit2 },
    ],
  },
];

const VIEW_STORAGE_KEY = "skill-studio-view";

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
            "inline-flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200",
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

function Placeholder({ view }: { view: ViewId }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Library className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-lg font-medium">{VIEW_TITLES[view]}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        脚手架已就位。后端 skill 扫描与链接引擎接入后，这里会显示内容。
      </p>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<ViewId>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY) as ViewId | null;
    return stored && stored in VIEW_TITLES ? stored : "library";
  });

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  return (
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 shadow-sm">
              <Layers className="h-[18px] w-[18px] text-white" />
            </div>
            <h1 className="text-lg font-semibold leading-none">
              {VIEW_TITLES[view]}
            </h1>
          </div>

          <div className="flex items-center gap-2" data-tauri-no-drag>
            <ThemeToggle />
            <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-8 px-2 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                title="重新扫描"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-8 px-2 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                title="设置"
                onClick={() => setView("settings")}
              >
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* ③ 侧栏 + 内容区 */}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="主导航"
          className="w-[236px] shrink-0 overflow-y-auto px-3 py-4"
        >
          <NavSwitcher
            sections={NAV_SECTIONS}
            active={view}
            onSelect={setView}
          />
        </nav>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="flex min-h-0 flex-1 flex-col overflow-hidden px-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Placeholder view={view} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
