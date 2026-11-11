/**
 * 遥测移除后的兼容桩：renderer 上下文收集已停用（恒返回 undefined，
 * 上层 reportRemoteUsageEventForRenderer 会因此跳过上报）。
 */
export interface AppTelemetryRuntime {
  getRendererContext: (rendererId: number) => undefined;
  getLatestRendererContext: () => undefined;
  setInteractive: (interactive: boolean) => void;
  syncRendererContext: (input: { rendererId: number; context: unknown }) => void;
  onRendererReady: (input: { hasPendingOAuthCallback: boolean; rendererId: number }) => void;
  onOAuthCallbackHandled: (input: { rendererId: number }) => void;
  dispose: () => void;
}

export function createAppTelemetryRuntime(_options: unknown): AppTelemetryRuntime {
  return {
    getRendererContext: () => undefined,
    getLatestRendererContext: () => undefined,
    setInteractive: () => {},
    syncRendererContext: () => {},
    onRendererReady: () => {},
    onOAuthCallbackHandled: () => {},
    dispose: () => {},
  };
}
