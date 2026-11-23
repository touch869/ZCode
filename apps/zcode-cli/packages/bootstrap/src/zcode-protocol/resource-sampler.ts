import type { Logger } from "@zcode/contracts";
import {
  createMemorySampleWriteGate,
  memoryUsageToSampleFields,
  zcodeProtocolNotifications,
  type MemorySample,
  type ZCodeProtocolNotification,
} from "@zcode/shared";
import {
  createZCodeProcessResourceSampler,
  type ZCodeProcessResourceSampler,
} from "../process-resource-sampler.js";
import type { ZCodeProtocolAgentServer } from "./server.js";

export function startProtocolResourceSampler(
  server: ZCodeProtocolAgentServer,
  send: (message: ZCodeProtocolNotification) => void,
  logger: Logger,
): ZCodeProcessResourceSampler | undefined {
  try {
    // 本地内存诊断日志：复用同一 60s 节拍，
    // 变化/心跳门控后才写一行，避免与消息流同频刷盘。
    const memoryDiagnosticsGate = createMemorySampleWriteGate();
    const sampler = createZCodeProcessResourceSampler({
      onSample: (sample, memoryUsage) => {
        send({
          method: zcodeProtocolNotifications.processResourceSample,
          params: sample,
        });
        // resident session TTL / 水位收敛借用资源采样节拍（60s）作兜底，不新增定时器；
        // sampler 对 onSample 已有异常兜底，单次 rebalance 失败不影响遥测上报。
        server.rebalanceResidentSessions();
        try {
          // 同一节拍先做瞬态事件时间兜底淘汰，再采样，日志里的 eventRows 反映淘汰后的驻留量。
          server.pruneSessionEventStores();
          server.pruneDetachedChildPublishers();
        } catch {
          // 兜底淘汰失败不影响资源上报与诊断日志。
        }
        try {
          const memorySample: MemorySample = {
            role: "agent_node",
            ...memoryUsageToSampleFields(memoryUsage),
            counters: server.collectMemoryDiagnostics(),
          };
          const reason = memoryDiagnosticsGate.evaluate(memorySample, Date.now());
          if (reason) {
            const { role: _role, counters, ...memoryFields } = memorySample;
            logger.info("Process memory sample", {
              event: "zcode_protocol.process.memory_sample",
              reason,
              ...memoryFields,
              counters,
            });
          }
        } catch {
          // 诊断日志失败只丢当前样本，不影响资源上报与 rebalance。
        }
      },
    });
    sampler.start();
    // 本线刻意不启动 3.18.1 的 CLI 分配诊断（startCliMemoryDiagnostics）。
    // 该模块把 bundle 函数名、行列号和 bundle 哈希写进 ~/.zcode/cli/memory-diagnostics，
    // 会随问题反馈的「上传诊断日志」离开本机；本线要求诊断数据不出端，故不采集、不落盘。
    return sampler;
  } catch {
    // 资源遥测是 best effort，初始化失败不能改变 Agent 启动结果。
    return undefined;
  }
}
