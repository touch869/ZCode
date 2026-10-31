// 「工作中」状态条的 TPS 速度插件：计算、轮询、格式化全部收敛在本文件。
// chat-loading.tsx 只提供通用 children 插槽，对本插件零感知；摘除/移植时整文件带走，
// 接线点只剩 ConversationTurnGroup 里的 <ChatLoadingTps/> 一行。
//
// 口径与 DeveloperToolsPane 的 tokenDebug 同源（sessionDebug rounds，仅 main_turn 完成请求，
// 全部为精确实测，不伪造）：
//   均   = 会话内已完成请求 Σ输出tokens ÷ Σ生成时长（生成时长 = 总耗时 − 首内容耗时）
//   实时 = 最近 30s 完成请求的同式聚合；空窗回退最近一轮实测 TPS
//          （生成中的单条长请求没有完成点，流式增量 token 协议里不存在，宁缺毋滥）
//   首字 = 最近一轮「请求发出→首个内容到达」（TTFT），区分开头慢（prefill/排队）与生成慢（decode）
import { useEffect, useState } from "react";
import type { SessionDebugSnapshot } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

type DebugRound = SessionDebugSnapshot["rounds"][number];

export interface WorkTpsStats {
  /** 会话平均输出速度（tokens/s）。 */
  average: number | null;
  /** 最近窗口实测输出速度（tokens/s）。 */
  recent: number | null;
  /** 最近一轮首内容延迟（ms）。 */
  firstContentMs: number | null;
}

const RECENT_WINDOW_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

/** rounds 按完成时间追加（CLI 侧保留最近 200 轮）；「均」即这 200 轮内的平均，注释即口径。 */
export function computeWorkTpsStats(
  rounds: readonly DebugRound[],
  nowMs: number,
  windowMs: number = RECENT_WINDOW_MS,
): WorkTpsStats {
  let totalTokens = 0;
  let totalDurationMs = 0;
  let windowTokens = 0;
  let windowDurationMs = 0;
  let lastMeasuredTps: number | null = null;
  let firstContentMs: number | null = null;
  for (const round of rounds) {
    const tokens = round.usage.outputTokens;
    const durationMs = round.generationDurationMs;
    if (tokens !== undefined && tokens > 0 && durationMs !== null && durationMs > 0) {
      totalTokens += tokens;
      totalDurationMs += durationMs;
      lastMeasuredTps = (tokens * 1000) / durationMs;
      if (round.recordedAt >= nowMs - windowMs) {
        windowTokens += tokens;
        windowDurationMs += durationMs;
      }
    }
    if (round.timeToFirstContentMs != null) firstContentMs = round.timeToFirstContentMs;
  }
  return {
    average: totalDurationMs > 0 ? (totalTokens * 1000) / totalDurationMs : null,
    recent: windowDurationMs > 0 ? (windowTokens * 1000) / windowDurationMs : lastMeasuredTps,
    firstContentMs,
  };
}

/**
 * 轮询 sessionDebug 聚合 TPS；节拍与 useSessionDebug 相同（1s、不重叠、防跨任务串台）。
 * 挂载即轮询、卸载即停（本组件只会在 ChatLoading 可见时被渲染，空闲零开销）。
 */
export function useWorkTpsStats({
  workspacePath,
  workspaceIdentity,
  sessionId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
}): WorkTpsStats {
  const { zcodeAgentService } = useServices();
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId]);
  const [stats, setStats] = useState<WorkTpsStats | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const data = await zcodeAgentService.readSessionDebug({
          workspacePath,
          workspaceIdentity,
          sessionId,
        });
        if (!disposed) setStats(computeWorkTpsStats(data.rounds, Date.now()));
      } catch {
        // 读失败保留上一拍；轮次只在请求完成时前进，1s 节拍本身就是近似刷新。
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), POLL_INTERVAL_MS);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [scopeKey, sessionId, workspaceIdentity, workspacePath, zcodeAgentService]);
  return stats ?? { average: null, recent: null, firstContentMs: null };
}

/** 挂在 ChatLoading children 插槽上的速度段；无任何实测数据时渲染 null（不留空隙）。 */
export function ChatLoadingTps({ context }: { context: ConversationRowRenderContext }) {
  const { intl, locale } = useZCodeIntl();
  const stats = useWorkTpsStats({
    workspacePath: context.workspacePath,
    workspaceIdentity: context.workspaceIdentity,
    sessionId: context.sessionId ?? null,
  });
  if (stats.average === null && stats.recent === null && stats.firstContentMs === null) return null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const dash = "—";
  return (
    <span
      aria-hidden="true"
      className="font-mono text-ui-caption tabular-nums text-foreground-subtle"
    >
      {intl.formatMessage(
        { id: "chat.loading.tpsSummary" },
        {
          average: stats.average === null ? dash : number.format(stats.average),
          recent: stats.recent === null ? dash : number.format(stats.recent),
          first:
            stats.firstContentMs === null
              ? dash
              : `${number.format(stats.firstContentMs / 1000)} ${intl.formatMessage({ id: "settings.usage.duration.second" })}`,
        },
      )}
    </span>
  );
}
