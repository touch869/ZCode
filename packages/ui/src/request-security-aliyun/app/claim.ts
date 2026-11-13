import type { CaptchaPort, RequestVerificationService } from "../contract.js";
import type { RequestVerificationProof } from "@zcode/shared";

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
  } catch {
    return undefined;
  }

  signal.throwIfAborted();
  if (!config || config.enabled === false) return undefined;
  if (!config.region || !config.prefix || !config.sceneId) return undefined;

  try {
    return await captchaPort.getProof(config, {
      signal,
      allowInteractive: true,
      timeoutMs: 120_000,
      source: "claim",
    });
  } catch {
    return undefined;
  }
}
