/**
 * 遥测移除后的兼容桩：返回直通 fetch（不做任何观测包装）。
 */
export function createDesktopTelemetryFetch(_net: unknown): typeof fetch {
  return (...args) => fetch(...args);
}
