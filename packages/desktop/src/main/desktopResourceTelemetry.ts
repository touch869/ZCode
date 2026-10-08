/**
 * 遥测移除后的兼容桩：资源采样上报全部 no-op。
 * resolveResourceUsageScene 保留真实语义（当前恒为 foreground）。
 */
export function configureDesktopResourceTelemetry(..._args: unknown[]): void {}
export function registerDesktopResourceTelemetry(..._args: unknown[]): void {}
export function stopDesktopResourceTelemetry(): void {}
export function resolveResourceUsageScene(): "background" | "foreground" {
  return "foreground";
}
export function ingestToolExecResource(..._args: unknown[]): void {}
