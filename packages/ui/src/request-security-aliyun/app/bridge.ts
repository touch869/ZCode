import { requestVerificationClaimHeaders } from "@zcode/shared";
import type { CaptchaPort, RuntimeHeadersRequest, RuntimeHeadersResponse } from "../contract.js";

export async function createRuntimeHeadersResponse(
  request: RuntimeHeadersRequest,
  signal: AbortSignal,
  captchaPort: CaptchaPort,
  failureMessage: string,
): Promise<RuntimeHeadersResponse | undefined> {
  const config = request.requestVerificationConfig;
  if (!config || config.enabled === false) {
    return { headersApplied: false, errorMessage: failureMessage };
  }
  if (!config.region || !config.prefix || !config.sceneId) {
    return { headersApplied: false, errorMessage: failureMessage };
  }

  try {
    const proof = await captchaPort.getProof(config, {
      signal,
      allowInteractive: true,
      timeoutMs: 120_000,
      source: request.reason ?? "model-request",
      providerId: request.providerId,
    });
    signal.throwIfAborted();
    if (!proof) return { headersApplied: false, errorMessage: failureMessage };

    return {
      headersApplied: true,
      runtimeProviderHeaders: requestVerificationClaimHeaders(proof),
    };
  } catch {
    if (signal.aborted) return undefined;
    return { headersApplied: false, errorMessage: failureMessage };
  }
}
