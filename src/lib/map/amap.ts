import AMapLoader from "@amap/amap-jsapi-loader";

// 高德 JS API 单例加载器：2021-12 后创建的 Key 必须配套安全密钥（jscode）
let amapPromise: Promise<unknown> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadAMap(jsKey: string, securityCode?: string): Promise<any> {
  if (!amapPromise) {
    if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    amapPromise = AMapLoader.load({
      key: jsKey,
      version: "2.0",
      plugins: ["AMap.ToolBar", "AMap.Scale", "AMap.Driving", "AMap.Walking", "AMap.Riding"],
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return amapPromise as Promise<any>;
}
