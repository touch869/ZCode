import type { CaptchaPort, RequestVerificationService } from "../contract.js";
import type { RequestVerificationProof } from "@zcode/shared";
import { logger } from "@/logger.js";

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function prepareClaim(
  service: RequestVerificationService,
  signal: AbortSignal,
  onVerifying: () => void,
  captchaPort: CaptchaPort,
): Promise<RequestVerificationProof | undefined> {
  onVerifying();

  let config;
  try {
    config = await service.getRequestVerificationConfig();
  } catch (error) {
    // 领取失败时 UI 只有一句本地化文案；这里记录失败阶段，便于从主进程日志定位根因。
    logger.lifecycle.warn("[request-security-aliyun] claim verification config failed", {
      stage: "config",
      error: describeError(error),
    });
    return undefined;
  }

  signal.throwIfAborted();
  if (!config || config.enabled === false) {
    logger.lifecycle.info("[request-security-aliyun] claim verification disabled", {
      stage: "config",
      hasConfig: Boolean(config),
    });
    return undefined;
  }
  const missing = [
    !config.region ? "region" : undefined,
    !config.prefix ? "prefix" : undefined,
    !config.sceneId ? "sceneId" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (missing.length > 0) {
    logger.lifecycle.warn("[request-security-aliyun] claim verification config incomplete", {
      stage: "config",
      missing,
    });
    return undefined;
  }

  try {
    const proof = await captchaPort.getProof(config, {
      signal,
      allowInteractive: true,
      timeoutMs: 120_000,
      source: "claim",
    });
    if (!proof) {
      logger.lifecycle.warn("[request-security-aliyun] claim captcha returned empty proof", {
        stage: "captcha",
        region: config.region,
        sceneId: config.sceneId,
      });
    }
    return proof;
  } catch (error) {
    // 不记录 captchaVerifyParam、token 或用户输入，只保留错误摘要与配置坐标。
    logger.lifecycle.warn("[request-security-aliyun] claim captcha failed", {
      stage: "captcha",
      error: describeError(error),
      region: config.region,
      sceneId: config.sceneId,
      source: "claim",
    });
    return undefined;
  }
}
