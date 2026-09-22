import { useEffect, useState } from "react";

/**
 * 窄视口（< md，对齐 tailwind max-md 断点）判定。
 * 手机远控/Web 端的两页式导航（列表页 ⇄ 聊天页）用它做布局切换；
 * 桌面端窗口缩窄不走该分支（由调用方以 isDesktop 排除），不影响桌面布局。
 */
export function useMobileLayoutViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(max-width: 767px)");
    const listener = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    query.addEventListener("change", listener);
    return () => {
      query.removeEventListener("change", listener);
    };
  }, []);

  return isMobile;
}
