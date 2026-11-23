import { requestVerificationClaimHeaders } from "@zcode/shared";
import type { CaptchaPort, RuntimeHeadersRequest, RuntimeHeadersResponse } from "../contract.js";
import { logger } from "@/logger.js";

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function createRuntimeHeadersResponse(
  request: RuntimeHeadersRequest,
  signal: AbortSignal,
  captchaPort: CaptchaPort,
  failureMessage: string,
): Promise<RuntimeHeadersResponse | undefined> {
  const config = request.requestVerificationConfig;
  const source = request.reason ?? "model-request";
  if (!config || config.enabled === false) {
    logger.lifecycle.info("[request-security-aliyun] runtime verification disabled", {
      stage: "config",
      source,
      providerId: request.providerId,
      hasConfig: Boolean(config),
    });
    return { headersApplied: false, errorMessage: failureMessage };
  }
  const missing = [
    !config.region ? "region" : undefined,
    !config.prefix ? "prefix" : undefined,
    !config.sceneId ? "sceneId" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (missing.length > 0) {
    logger.lifecycle.warn("[request-security-aliyun] runtime verification config incomplete", {
      stage: "config",
      source,
      providerId: request.providerId,
      missing,
    });
    return { headersApplied: false, errorMessage: failureMessage };
  }

  try {
    const proof = await captchaPort.getProof(config, {
      signal,
      allowInteractive: true,
      timeoutMs: 120_000,
      source,
      providerId: request.providerId,
    });
    signal.throwIfAborted();
    if (!proof) {
      logger.lifecycle.warn("[request-security-aliyun] runtime captcha returned empty proof", {
        stage: "captcha",
        source,
        providerId: request.providerId,
        region: config.region,
        sceneId: config.sceneId,
      });
      return { headersApplied: false, errorMessage: failureMessage };
    }

    return {
      headersApplied: true,
      runtimeProviderHeaders: requestVerificationClaimHeaders(proof),
    };
  } catch (error) {
    if (signal.aborted) return undefined;
    // 不记录 captchaVerifyParam、token 或请求正文；错误摘要足以区分 SDK、超时与配置问题。
    logger.lifecycle.warn("[request-security-aliyun] runtime captcha failed", {
      stage: "captcha",
      source,
      providerId: request.providerId,
      error: describeError(error),
      region: config.region,
      sceneId: config.sceneId,
    });
    return { headersApplied: false, errorMessage: failureMessage };
  }
}
