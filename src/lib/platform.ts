// 平台判定只用于布局决策（拖拽条高度、是否自绘窗口按钮），
// 不依赖 @tauri-apps/plugin-os，避免为两个布尔值多引一个插件。
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const isMac = () =>
  /Macintosh|Mac OS X/.test(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );

export const isWindows = () => /Windows/.test(ua);
export const isLinux = () => /Linux/.test(ua) && !/Android/.test(ua);
