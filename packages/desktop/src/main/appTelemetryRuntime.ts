/**
 * 遥测移除后的兼容桩：renderer 上下文收集已停用（恒返回 undefined，
 * 上层 reportRemoteUsageEventForRenderer 会因此跳过上报）。
 */
export function createAppTelemetryRuntime(_options: unknown): {
  getRendererContext: (rendererId: number) => undefined;
  getLatestRendererContext: () => undefined;
  setInteractive: (interactive: boolean) => void;
} {
  return {
    getRendererContext: () => undefined,
    getLatestRendererContext: () => undefined,
    setInteractive: () => {},
    syncRendererContext: () => {},
    onRendererReady: () => {},
    onOAuthCallbackHandled: () => {},
  };
}
