export interface DesktopTelemetryFetchSource {
  fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
}

/**
 * 遥测移除后的兼容桩：返回直通 fetch（不做任何观测包装）。
 */
export function createDesktopTelemetryFetch(source: DesktopTelemetryFetchSource): typeof fetch {
  return (input, init) => source.fetch(input, init);
}
