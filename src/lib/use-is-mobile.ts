"use client";

// 移动端检测：UA 优先，宽度兜底；挂载前返回 null 避免 SSR 水合不一致
import { useEffect, useState } from "react";

export function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent);
  return uaMobile || window.innerWidth <= 768;
}

/**
 * 返回 true/false（已检测）或 null（尚未挂载，调用方应渲染加载态）。
 * 监听窗口尺寸变化，桌面/手机窗口互切时自动切换版本。
 */
export function useIsMobile(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setIsMobile(detectMobile());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}
