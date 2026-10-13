/** 遥测移除后的兼容桩：网络观测上报已停用。导出面与官方对齐（含 3.15.1 新增的
 * web remote relay 计数），消费方零改动；所有函数 no-op，常量保留真实值。 */
export const NETWORK_REPORT_INTERVAL_MS = 300_000;
export const WEB_REMOTE_RELAY_INTERFACE = "web_remote_control.relay";
export function ingestArmsApiEventsFromBatch(..._args: unknown[]): void {}
export function ingestHostNetworkObservations(..._args: unknown[]): void {}
export function noteWebRemoteRelayConnectAttempt(..._args: unknown[]): void {}
export function noteWebRemoteRelayReconnect(..._args: unknown[]): void {}
export function configureDesktopNetworkTelemetry(..._args: unknown[]): void {}
export function registerDesktopNetworkTelemetry(..._args: unknown[]): void {}
export function stopDesktopNetworkTelemetry(): void {}
