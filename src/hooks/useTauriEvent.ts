import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 订阅 Tauri 事件。
 *
 * 两处保险（照 cc-switch 的实现）：
 * - handler 存在 ref 里，回调总是拿到最新闭包，不必把它放进依赖
 * - disposed 标志避免 listen 的 promise 在组件已卸载后才 resolve 导致漏卸载
 */
export function useTauriEvent<P>(
  eventName: string,
  handler: (payload: P) => void | Promise<void>,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void (async () => {
      try {
        const off = await listen<P>(eventName, (e) => {
          void handlerRef.current(e.payload);
        });
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      } catch {
        // 非 Tauri 环境（vitest / 浏览器预览）下静默忽略
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [eventName]);
}
