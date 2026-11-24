/**
 * 本线 renderer-action-trace 接缝：把远端灰度 rollout 换成静态 disabled 快照。
 *
 * 原因：官方 4.0.0 里 renderer action trace 与本地 TTFT 共用 `/api/v1/client/configs`
 * 的远端配置，服务端默认下发 `enabled: true`，主进程按 60s 定时器 + 1h TTL 刷新。
 * 而本线的 trace exporter 没有 OTLP 端点（`rendererActionTraceExporter.ts` 在无
 * `OTEL_EXPORTER_OTLP_*` 时返回 undefined），span 只能在主进程排队后被丢弃；渲染端却
 * 仍在按配置采样、生成 span 并通过 IPC 上报，纯属空转。
 *
 * 这里只替换「取配置」这一层：快照固定为 disabled，`refresh()` 不发起任何网络请求也不
 * 打日志；IPC/渲染端代码与本地显式开关（`ZCODE_RENDERER_ACTION_TRACE_ENABLED`，
 * 由 `rendererActionTraceIpc.ts` 的 resolveRuntimeConfig 应用）保持原样。
 */
import { DISABLED_RENDERER_ACTION_TRACE_CONFIG } from "@zcode/shared";
import type { RendererActionTraceRollout } from "./rendererActionTraceRollout.js";

export function createLocalRendererActionTraceRollout(): RendererActionTraceRollout {
  const snapshot = { ...DISABLED_RENDERER_ACTION_TRACE_CONFIG };
  return {
    // 与远端 rollout 的对外语义一致：refresh 永不 reject。
    refresh: async () => snapshot,
    getSnapshot: () => snapshot,
    awaitFirstDecision: async () => snapshot,
  };
}
