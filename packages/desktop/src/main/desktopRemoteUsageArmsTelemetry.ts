/**
 * 遥测移除后的兼容桩：远端连接/断开/周期 gauge 上报全部 no-op。
 * 类型定义保留 —— desktopRemoteSessions 等消费方仍以这些类型承载连接统计。
 */

export interface RemoteConnectionStats {
  activeSessionCount: number;
  activeTargetCount: number;
}

export type RemoteGaugeTransition =
  | "connected"
  | "connection-closed"
  | "disposed"
  | "window-closed"
  | "host-exit"
  | "app-shutdown"
  | "none";

export type RemoteDisconnectReason = Exclude<RemoteGaugeTransition, "connected" | "none">;

export function reportRemoteConnectionStateChangedToArms(..._args: unknown[]): void {}
export function reportRemoteDisconnectToArms(..._args: unknown[]): void {}
export function stopRemoteUsageArmsPeriodicSampling(): void {}
export function configureRemoteUsageArmsTelemetry(..._args: unknown[]): void {}
export function reportRemoteConnectResultToArms(..._args: unknown[]): void {}
