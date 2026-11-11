/**
 * 遥测移除后的兼容桩：稳定性埋点全部 no-op。
 * getStabilityLifecycleScene 保留真实语义（当前恒为 app_quit）。
 */
export function configureDesktopStabilityTelemetry(..._args: unknown[]): void {}
export function getStabilityLifecycleScene(): "app_quit" | "update_install" {
  return "app_quit";
}
export function notifyStabilityAppExit(..._args: unknown[]): void {}
export function notifyStabilityLifecycle(..._args: unknown[]): void {}
export function reportAgentProcessExitToArms(..._args: unknown[]): void {}
export function reportAgentProcessReadyToArms(..._args: unknown[]): void {}
export function reportAgentProcessStartToArms(..._args: unknown[]): void {}
export function reportAgentProcessSpawnErrorToArms(..._args: unknown[]): void {}
export function reportAgentProcessExceptionToArms(..._args: unknown[]): void {}
export function registerDesktopStabilityMonitors(..._args: unknown[]): void {}
export function registerStabilityMainWindow(..._args: unknown[]): void {}
export function scheduleReportPerfAppStartAfterMainViewReady(): void {}
