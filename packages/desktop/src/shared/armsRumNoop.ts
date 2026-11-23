/**
 * 本线遥测移除接缝：`@arms/rum-electron`（主进程）与 `@arms/rum-electron/browser`
 * （渲染进程）的本地 no-op 替身。
 *
 * 为什么用替身而不是逐文件改写成空模块：官方 4.0.0 的遥测逻辑（场景判定、阈值、
 * 崩溃分类、事件过滤）与 SDK 调用交织在十几个文件里，整族删除会让每次跟版都要重写；
 * 而真正决定「是否有出端」的只有 SDK 是否被加载。这里保留官方调用形状，SDK 永不
 * import、永不初始化、不产生任何网络请求，同时官方文件只改一行 import。
 *
 * 方法集合对齐 4.0.0 源码中的实际调用：client.useReporter / getConfig / init /
 * sendCustom / sendEvent / setConfig。新增调用一旦出现，typecheck 会在这里报缺失，
 * 不会静默降级。
 */
interface ArmsReporterLike {
  // 官方在 useReporter 里把 request 包装成 (context, bundle) 两参；这里只承载形状，
  // 用 never[] 让任意具体签名都能赋值，且替身自身永不调用。
  request: (...args: never[]) => Promise<unknown>;
  [key: string]: unknown;
}

interface ArmsClientLike {
  useReporter: (reporter: ArmsReporterLike) => void;
}

const client: ArmsClientLike = {
  useReporter: (_reporter) => {},
};

const armsRumNoop = {
  client,
  init: async (_config: unknown): Promise<void> => {},
  sendCustom: (_event: unknown): void => {},
  sendEvent: (_event: unknown): void => {},
  setConfig: (_key: string, _value: unknown): void => {},
  // 官方据此标注上报环境；未初始化即本地，避免任何“生产环境”判定影响其他逻辑。
  getConfig: (): { env: string } => ({ env: "local" }),
};

export default armsRumNoop;
