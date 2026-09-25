import type { Settings } from "@/types";
import { supportsMcp } from "@/lib/mcpAgents";

export type StaticView =
  "mcp" | "library" | "projects" | "settings" | "install";
export type ViewId = StaticView | `agent:${string}`;
export const VIEW_STORAGE_KEY = "skill-studio-view";

/** Resolve persisted navigation only against the loaded settings. */
export function readInitialView(
  settings?: Settings,
  targetId = "local",
): ViewId {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  let view: ViewId =
    stored &&
    (stored === "mcp" ||
      stored === "projects" ||
      stored === "library" ||
      stored.startsWith("agent:"))
      ? (stored as ViewId)
      : "library";
  const mcp = initialResource(view, settings) === "mcp";
  const hub = mcp ? "mcp" : "library";
  if (view === "mcp" && settings?.manageMcp === false) view = "library";
  if (view.startsWith("agent:")) {
    const agent = view.slice("agent:".length);
    if (
      settings?.disabledAgents?.includes(agent) ||
      (mcp && !supportsMcp(agent))
    )
      view = hub;
  }
  if (
    targetId !== "local" &&
    mcp &&
    (view === "projects" || view.startsWith("agent:"))
  )
    view = hub;
  return view;
}

export function initialResource(
  view: ViewId,
  settings?: Settings,
): "skills" | "mcp" {
  if (settings?.manageMcp === false) return "skills";
  if (view === "mcp") return "mcp";
  if (view === "library") return "skills";
  return localStorage.getItem("skill-studio-resource") === "mcp"
    ? "mcp"
    : "skills";
}
